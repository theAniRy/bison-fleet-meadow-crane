#!/usr/bin/env python3
"""Build src/data/catalog.json from the ISS outline and the file export."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path

ISS_PATH = Path("/workspace/attachments/ИСС_Список_документов.md")
FILES_PATH = Path("/workspace/attachments/Экспортировать список файлов")
OUT_PATH = Path("/workspace/src/data/catalog.json")

STOP = {
    "и", "в", "во", "на", "по", "от", "для", "с", "со", "к", "ко", "о", "об", "обо",
    "при", "из", "до", "не", "или", "а", "но", "за", "под", "над", "без", "через",
    "это", "как", "их", "его", "ее", "её", "при", "том", "числе", "гг", "год", "года",
    "г", "мм", "гуп", "ди", "эмс", "эм", "пр", "расп", "ук", "n", "№",
}

FOLDER_TO_SECTION = {
    "Адреса вестибюлей станций и ТПУ": "Адреса вестибюлей станций и ТПУ",
    "ДДС": "ДДС",
    "ЕДЦ": "ЕДЦ",
    "Инструкция о порядке хранения и выдаче ключей": "Инструкция о порядке хранения и выдаче ключей",
    "Инструкция о проходе в тоннель + изменения": "Инструкция о проходе в тоннель",
    "Линии метрополитена (светофоры, ветки)": "Линии метрополитена",
    "Моторно-рельсовый транспорт": "Моторно-рельсовый транспорт",
    "Обслуживание зданий АБК": "Обслуживание зданий АБК",
    "Оперативные переговоры": "Оперативные переговоры, регламенты взаимодействия",
    "Осушение водопроводных сетей на линиях метрополитена": "Осушение водопроводных сетей на линиях метрополитена",
    "По Диспетчерскому участку": "По Диспетчерскому участку",
    "По Метрополитену": "По Метрополитену",
    "По службе": "По ЭМС",
    "Разграничения": "По ЭМС",
    "Расположение подстанций": "Расположение подстанций",
    "Тех. документация": "Тех. документация",
    "Транспортная безопасность и охранная сигнализация": "Транспортная безопасность",
    "Форменная одежда": "Форменная одежда",
    "Эксплуатация объектов нового строительства": "Эксплуатация объектов нового строительства",
}

CODE_RE = re.compile(
    r"(?<![А-Яа-яA-Za-z0-9])(?P<prefix>ЭМ-ДУ|ДИ-ЭМС|УД|ДИ|ЭМ|УК)"
    r"\s*[-–—_]*\s*(?P<body>\d+(?:\s*[-–—]+\s*\d+)*)\s*(?P<letter>[рpРP])?"
    r"(?:\s*[/_]\s*(?P<tail>\d+)(?:\s*[_\-]\s*(?P<extra>\d+))?)?",
    re.IGNORECASE,
)
IP_RE = re.compile(
    r"ИП\s*[-_]\s*ЭМС\s*[-_]\s*ДИ\s*[-_]\s*(\d+)\s*[-_]\s*(\d+)",
    re.IGNORECASE,
)
KTO_RE = re.compile(
    r"КТО\s*[-–—]?\s*ЭМ\s*[-–—]?\s*(\d+)(?:\s*[-–—]\s*(\d+))?",
    re.IGNORECASE,
)
DATE_RE = re.compile(r"(?<!\d)(\d{2})\.(\d{2})\.(\d{2,4})(?!\d)")
INDEX_RE = re.compile(r"^(\d+)(?:\s*[-–—.]\s*(\d+))?(?:\s*[-–—.])?\s+")
LEGACY_RE = re.compile(
    r"(?:пр|расп|ук|прот|n|№)\.?\s*(\d{1,5})\s*([рpРP])?",
    re.IGNORECASE,
)
SP_RE = re.compile(r"(?:СП|SP)\s*[-–—]?\s*(\d+(?:\.\d+)*)", re.IGNORECASE)
ORDER_BARE_RE = re.compile(r"(?<!\d)(\d{3,5})\s*([рpРP])?(?!\d)")


def norm_text(value: str) -> str:
    value = value.lower().replace("ё", "е")
    value = value.replace("«", " ").replace("»", " ")
    value = re.sub(r"[^\w\s]+", " ", value, flags=re.UNICODE)
    value = re.sub(r"\s+", " ", value).strip()
    return value


def tokens(value: str) -> list[str]:
    out = []
    for token in norm_text(value).split():
        if token in STOP or len(token) < 3 or token.isdigit():
            continue
        out.append(token[:5])
    return out


def token_score(left: str, right: str) -> float:
    a = set(tokens(left))
    b = set(tokens(right))
    if not a or not b:
        return 0.0
    inter = a & b
    return len(inter) / len(a)


def full_date(day: str, month: str, year: str) -> str:
    if len(year) == 2:
        year = ("19" if int(year) >= 80 else "20") + year
    return f"{day}.{month}.{year}"


def dates_in(value: str) -> list[str]:
    found = []
    for day, month, year in DATE_RE.findall(value):
        try:
            found.append(full_date(day, month, year))
        except ValueError:
            continue
    return found


def strip_dates(value: str) -> str:
    return DATE_RE.sub(" ", value)


def canonical_code(prefix: str, body: str, letter: str | None, tail: str | None) -> str:
    prefix = prefix.upper().replace(" ", "")
    body = re.sub(r"\s*[-–—]+\s*", "-", body)
    code = f"{prefix}-{body}"
    if letter:
        code += "Р"
    if tail:
        code += f"/{tail}"
    return code


def codes_in(value: str) -> list[str]:
    found: list[str] = []
    for match in CODE_RE.finditer(value):
        found.append(
            canonical_code(
                match.group("prefix"),
                match.group("body"),
                match.group("letter"),
                match.group("tail"),
            )
        )
    for num, year in IP_RE.findall(value):
        found.append(f"ИП-ЭМС-ДИ-{num}-{year}")
    seen = set()
    unique = []
    for code in found:
        if code not in seen:
            seen.add(code)
            unique.append(code)
    return unique


def code_body(code: str) -> str:
    """Body + optional tail, ignoring the issuing prefix (УД/ДИ/УК typos)."""
    if code.startswith("ИП-"):
        return code
    match = re.match(r"^(?:ЭМ-ДУ|ДИ-ЭМС|УД|ДИ|ЭМ|УК)-(.+)$", code)
    return match.group(1) if match else code


def code_stem(code: str) -> str:
    """Body without the /tail, so УД-08-2723/24 and a filename year-suffix still meet."""
    body = code_body(code)
    return body.split("/")[0]


def kto_set(value: str) -> set[int]:
    nums: set[int] = set()
    for a_raw, b_raw in KTO_RE.findall(value):
        a = int(a_raw)
        b = int(b_raw) if b_raw else a
        if b < a:
            a, b = b, a
        if b - a > 30:
            nums.add(a)
            nums.add(b)
        else:
            nums.update(range(a, b + 1))
    return nums


def index_of(value: str) -> tuple[str, str | None] | None:
    match = INDEX_RE.match(value.strip())
    if not match:
        return None
    return match.group(1), match.group(2)


def legacy_keys(value: str) -> set[str]:
    cleaned = strip_dates(value)
    keys: set[str] = set()
    for num, letter in LEGACY_RE.findall(cleaned):
        keys.add(num + ("р" if letter else ""))
    for num, letter in ORDER_BARE_RE.findall(cleaned):
        # Skip years and pure catalog-looking leftovers already handled.
        if num.startswith("19") or num.startswith("20"):
            continue
        keys.add(num + ("р" if letter else ""))
    for sp in SP_RE.findall(value):
        keys.add("сп:" + sp.lower())
    if re.search(r"1\s*[/\-]\s*[НнNn]", value):
        keys.add("1-н")
    return keys


def nid(parts: list[str]) -> str:
    digest = hashlib.sha1("\n".join(parts).encode("utf-8")).hexdigest()[:10]
    return "n" + digest


def fid(path: str) -> str:
    digest = hashlib.sha1(path.encode("utf-8")).hexdigest()[:10]
    return "f" + digest


class Node:
    def __init__(self, title: str, path: list[str]):
        self.title = title.strip()
        self.path = path
        self.id = nid(path)
        self.children: list[Node] = []
        self.codes = codes_in(self.title)
        self.code = self.codes[-1] if self.codes else None
        self.kto = kto_set(self.title)
        ds = dates_in(self.title)
        self.date = ds[-1] if ds else None
        self.index = index_of(self.title)
        self.legacy = legacy_keys(self.title)
        self.file_ids: list[str] = []

    def to_json(self) -> dict:
        data: dict = {"id": self.id, "title": self.title}
        if self.code:
            data["code"] = self.code
        if self.date:
            data["date"] = self.date
        if self.file_ids:
            data["fileIds"] = self.file_ids
        if self.children:
            data["children"] = [child.to_json() for child in self.children]
        return data


def parse_iss(text: str) -> list[Node]:
    roots: list[Node] = []
    stack: list[tuple[int, Node]] = []
    for raw in text.splitlines():
        if not raw.strip().startswith("- "):
            continue
        spaces = len(raw) - len(raw.lstrip(" "))
        depth = spaces // 2
        title = raw.strip()[2:].strip()
        if not title:
            continue
        while stack and stack[-1][0] >= depth:
            stack.pop()
        parent_path = stack[-1][1].path if stack else []
        node = Node(title, parent_path + [title])
        if stack:
            stack[-1][1].children.append(node)
        else:
            roots.append(node)
        stack.append((depth, node))
    return roots


def walk(nodes: list[Node]):
    for node in nodes:
        yield node
        yield from walk(node.children)


def section_nodes(roots: list[Node], title: str) -> list[Node]:
    want = norm_text(title)
    for node in walk(roots):
        if norm_text(node.title) == want:
            return list(walk(node.children)) or [node]
    return []


def find_section_node(roots: list[Node], title: str) -> Node | None:
    want = norm_text(title)
    for node in walk(roots):
        if norm_text(node.title) == want:
            return node
    return None


def attach(node: Node, file_id: str) -> None:
    if file_id not in node.file_ids:
        node.file_ids.append(file_id)


def parse_files(text: str) -> list[dict]:
    files = []
    for raw in text.splitlines():
        path = raw.strip().rstrip("/")
        if not path or raw.strip().endswith("/") or path == "docs":
            continue
        name = path.split("/")[-1]
        stem = re.sub(r"\.(pdf|htm)$", "", name, flags=re.IGNORECASE)
        parts = path.split("/")
        folder = parts[2] if len(parts) > 3 and parts[1] == "Инструкции (общие)" else ""
        if len(parts) == 2:
            folder = ""
        files.append(
            {
                "id": fid(path),
                "name": name,
                "stem": stem,
                "path": path,
                "folder": folder,
                "codes": codes_in(stem),
                "code": codes_in(stem)[-1] if codes_in(stem) else None,
                "bodies": [code_body(c) for c in codes_in(stem)],
                "stems": [code_stem(c) for c in codes_in(stem)],
                "kto": kto_set(stem),
                "dates": dates_in(stem),
                "index": index_of(stem),
                "legacy": legacy_keys(stem),
            }
        )
    return files


def best_title_nodes(candidates: list[Node], stem: str, threshold: float) -> list[Node]:
    scored = []
    stem_norm = norm_text(stem)
    # Drop leading catalog index from the stem so "46 Перечень нарушений" scores the title.
    stem_for_score = INDEX_RE.sub("", stem).strip() or stem
    for node in candidates:
        title_norm = norm_text(node.title)
        score = token_score(stem_for_score, node.title)
        if stem_norm and (stem_norm in title_norm or title_norm in stem_norm):
            score = max(score, 0.95)
        if node.title and stem_for_score and norm_text(stem_for_score) in title_norm:
            score = max(score, 0.92)
        scored.append((score, node))
    if not scored:
        return []
    top = max(score for score, _ in scored)
    if top < threshold:
        return []
    return [node for score, node in scored if score == top or score >= max(threshold, top - 0.02)]


def dedup(nodes: list[Node]) -> list[Node]:
    seen = set()
    out = []
    for node in nodes:
        if node.id in seen:
            continue
        seen.add(node.id)
        out.append(node)
    return out


def metro_pool(metro_nodes: list[Node], file: dict) -> list[Node]:
    if not file["index"]:
        return []
    idx, sub = file["index"]
    pool = []
    for node in metro_nodes:
        if not node.index or node.index[0] != idx:
            continue
        if sub and node.index[1] and node.index[1] != sub:
            continue
        pool.append(node)
    if not pool:
        return []
    file_dates = set(file["dates"])
    file_legacy = set(file["legacy"]) - {idx}
    dated = [node for node in pool if file_dates and node.date in file_dates]
    numbered = [node for node in pool if file_legacy and (node.legacy & file_legacy)]
    if dated and numbered:
        both = [node for node in dated if node in numbered]
        return both or dated
    if dated:
        return dated
    if numbered:
        return numbered
    if len({node.title for node in pool}) == 1:
        return pool
    return best_title_nodes(pool, file["stem"], 0.55)


def match(roots: list[Node], files: list[dict]) -> None:
    by_code: dict[str, list[Node]] = {}
    by_body: dict[str, list[Node]] = {}
    by_secondary: dict[str, list[Node]] = {}
    by_stem_date: dict[tuple[str, str], list[Node]] = {}
    for node in walk(roots):
        if not node.code:
            continue
        by_code.setdefault(node.code, []).append(node)
        by_body.setdefault(code_body(node.code), []).append(node)
        for extra in node.codes[:-1]:
            by_secondary.setdefault(extra, []).append(node)
        if node.date:
            by_stem_date.setdefault((code_stem(node.code), node.date), []).append(node)

    metro_section = find_section_node(roots, "По Метрополитену")
    metro_nodes = list(walk([metro_section])) if metro_section else []
    section_node_by_title = {}
    for title in set(FOLDER_TO_SECTION.values()):
        found = find_section_node(roots, title)
        if found:
            section_node_by_title[title] = found

    for file in files:
        linked: list[Node] = []
        how = ""

        code_hits: list[Node] = []
        for code in file["codes"]:
            code_hits.extend(by_code.get(code, []))
        if not code_hits:
            for body in file["bodies"]:
                code_hits.extend(by_body.get(body, []))
        code_hits = dedup(code_hits)
        if code_hits and file["kto"]:
            narrowed = [node for node in code_hits if node.kto and (node.kto & file["kto"])]
            if narrowed:
                code_hits = narrowed
        if code_hits:
            linked = code_hits
            how = "code"

        if not linked:
            for stem_key, date in ((stem, date) for stem in file["stems"] for date in file["dates"]):
                linked.extend(by_stem_date.get((stem_key, date), []))
            linked = dedup(linked)
            if linked:
                how = "stem-date"

        if not linked and file["dates"]:
            secondary = []
            for code in file["codes"]:
                for node in by_secondary.get(code, []):
                    if node.date in file["dates"]:
                        secondary.append(node)
            linked = dedup(secondary)
            if linked:
                how = "cited-code+date"

        if not linked and file["kto"]:
            kto_hits = []
            for node in walk(roots):
                if not node.kto:
                    continue
                inter = node.kto & file["kto"]
                if not inter:
                    continue
                cover = len(inter) / len(file["kto"])
                node_cover = len(inter) / len(node.kto)
                if cover >= 0.6 and node_cover >= 0.5:
                    kto_hits.append((cover + node_cover, node))
            if kto_hits:
                top = max(score for score, _ in kto_hits)
                linked = [node for score, node in kto_hits if score >= top - 0.05]
                how = "kto"

        in_metro_bucket = file["folder"] == "По Метрополитену" or (
            not file["folder"] and file["index"] and "/Инструкции (общие)/" in f"/{file['path']}"
        )
        if not linked and in_metro_bucket:
            linked = metro_pool(metro_nodes, file)
            if linked:
                how = "metro-index"

        if not linked and file["folder"] in FOLDER_TO_SECTION:
            pool = section_nodes(roots, FOLDER_TO_SECTION[file["folder"]])
            docs = [node for node in pool if not node.children] or pool
            file_dates = set(file["dates"])
            dated = []
            for node in docs:
                legacy_ok = bool(file["legacy"] and (node.legacy & file["legacy"]))
                date_ok = bool(file_dates and node.date in file_dates)
                if date_ok and legacy_ok:
                    dated.append(node)
                elif date_ok and token_score(INDEX_RE.sub("", file["stem"]), node.title) >= 0.45:
                    dated.append(node)
            if dated:
                linked = dedup(dated)
                how = "section-date"
            else:
                linked = best_title_nodes(docs, file["stem"], 0.72)
                if linked:
                    how = "title"

        if not linked and not file["folder"]:
            docs = [node for node in walk(roots) if not node.children]
            linked = best_title_nodes(docs, file["stem"], 0.8)
            if linked:
                how = "global-title"

        # Known filename shorthand that the outline spells out in full.
        if not linked and norm_text(file["stem"]).startswith("отт асу"):
            target = find_section_node(roots, "АСУ ЭМС. Общие технические требования (Пр.1667  20.07.12)")
            if target:
                linked = [target]
                how = "alias"

        if not linked and file["folder"] in FOLDER_TO_SECTION:
            section = section_node_by_title.get(FOLDER_TO_SECTION[file["folder"]])
            leaves = [
                node
                for node in section_nodes(roots, FOLDER_TO_SECTION[file["folder"]])
                if not node.children
            ]
            if len(leaves) == 1:
                linked = leaves
                how = "only-leaf"
            elif section:
                linked = [section]
                how = "folder"

        for node in linked:
            attach(node, file["id"])
        file["matched"] = len(linked)
        file["how"] = how


def main() -> None:
    roots = parse_iss(ISS_PATH.read_text(encoding="utf-8"))
    files = parse_files(FILES_PATH.read_text(encoding="utf-8"))
    match(roots, files)

    nodes = list(walk(roots))
    with_files = sum(1 for node in nodes if node.file_ids)
    leaves = [node for node in nodes if not node.children]
    leaves_with = sum(1 for node in leaves if node.file_ids)
    matched_files = [file for file in files if file["matched"]]
    unmatched = [file for file in files if not file["matched"]]

    print(f"nodes {len(nodes)} leaves {len(leaves)}")
    print(f"nodes with file {with_files} leaves with file {leaves_with}")
    print(f"files {len(files)} matched {len(matched_files)} unmatched {len(unmatched)}")
    from collections import Counter
    print("how", Counter(file["how"] or "none" for file in files))
    print("--- non-code ---")
    for file in files:
        if file["how"] not in ("code", "stem-date", "kto", "cited-code+date", ""):
            print(f"{file['how']:16} {file['name']}")
    print("--- unmatched ---")
    for file in unmatched:
        print(file["path"])

    payload = {
        "generatedFrom": ["ИСС_Список_документов.md", "Экспортировать список файлов"],
        "tree": [node.to_json() for node in roots],
        "files": [
            {"id": file["id"], "name": file["name"], "path": file["path"]}
            for file in files
        ],
    }
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("bytes", OUT_PATH.stat().st_size)


if __name__ == "__main__":
    main()
