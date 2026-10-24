import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderOpen,
  Library,
  Search,
  Star,
  X,
} from "lucide-react";
import {
  archive,
  archiveFileCount,
  docFiles,
  docs,
  fileById,
  looseFileIds,
  placements,
  stats,
  topIds,
  type ArchiveNode,
  type DocIndex,
} from "@/lib/catalog";

const FAV_KEY = "iss-favorites";

type View = "iss" | "archive";
type Filter = "all" | "file" | "nofile" | "fav";
type ArchiveFilter = "all" | "loose";
type Selection =
  | { kind: "doc"; id: string }
  | { kind: "file"; id: string }
  | { kind: "dir"; id: string; name: string; path: string; count: number };

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function queryTokens(query: string): string[] {
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

function matchesBlob(blob: string, tokens: string[]) {
  return tokens.every((token) => blob.includes(token));
}

function Highlight({ text, query }: { text: string; query: string }) {
  const tokens = queryTokens(query).filter((token) => token.length > 1);
  if (!tokens.length) return <>{text}</>;
  const pattern = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "ig");
  const parts = text.split(pattern);
  const keys = new Set(tokens);
  return (
    <>
      {parts.map((part, index) =>
        keys.has(part.toLowerCase()) ? (
          <mark key={index} className="rounded-sm bg-amber/30 text-fg">
            {part}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function CatalogBrowser() {
  const [view, setView] = useState<View>("iss");
  const [filter, setFilter] = useState<Filter>("all");
  const [archiveFilter, setArchiveFilter] = useState<ArchiveFilter>("all");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [archiveExpanded, setArchiveExpanded] = useState<Set<string>>(() => new Set(archive.map((node) => node.id)));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(FAV_KEY);
      if (!stored) return;
      const ids = JSON.parse(stored) as string[];
      if (Array.isArray(ids)) setFavs(new Set(ids));
    } catch {
      /* ignore broken local favorites */
    }
  }, []);

  useEffect(() => {
    if (selection?.kind !== "doc") return;
    document.querySelector(`[data-doc="${selection.id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selection]);

  const tokens = useMemo(() => queryTokens(query), [query]);

  const visibleDocs = useMemo(() => {
    if (!tokens.length && filter === "all") return null;
    const matched = new Set<string>();
    for (const item of docs.values()) {
      if (tokens.length && !matchesBlob(item.blob, tokens)) continue;
      if (filter === "file" && !item.hasFile) continue;
      if (filter === "nofile" && (item.childIds.length > 0 || item.hasFile)) continue;
      if (filter === "fav" && !favs.has(item.id)) continue;
      matched.add(item.id);
    }
    const visible = new Set<string>();
    for (const id of matched) {
      visible.add(id);
      const item = docs.get(id);
      item?.ancestors.forEach((ancestor) => visible.add(ancestor));
    }
    return visible;
  }, [tokens, filter, favs]);

  function toggleFav(id: string) {
    setFavs((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem(FAV_KEY, JSON.stringify([...next]));
      return next;
    });
  }

  function selectDoc(id: string) {
    setSelection({ kind: "doc", id });
    setDetailOpen(true);
    setCopied("");
  }

  function toggleDoc(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const forceOpen = tokens.length > 0;

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <header className="shrink-0 border-b border-line px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-amber font-mono text-xs font-medium text-ink">
            ИСС
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-balance">Перечень инструкций</h1>
            <p className="truncate text-sm text-muted">Электромеханическая служба · общий перечень</p>
          </div>
        </div>
        <p className="mt-2 font-mono text-xs text-faint">
          {stats.sections} разделов · {stats.leaves} документов · {stats.linkedFiles} из {stats.files} файлов
          найдены
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <section
          className={cx(
            "flex min-h-0 w-full flex-col lg:w-96 lg:shrink-0 lg:border-r lg:border-line",
            detailOpen && "max-lg:hidden",
          )}
        >
          <div className="shrink-0 space-y-3 border-b border-line p-3">
            <div className="flex gap-2">
              <ViewButton active={view === "iss"} onClick={() => setView("iss")} label="Перечень" icon="library" />
              <ViewButton
                active={view === "archive"}
                onClick={() => setView("archive")}
                label="Архив"
                icon="archive"
              />
            </div>
            <label className="relative block">
              <span className="sr-only">Поиск по перечню</span>
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={view === "iss" ? "Название, номер, дата, путь" : "Имя файла или папка"}
                className="w-full rounded-md border border-line bg-surface py-2.5 pr-10 pl-10 text-base text-fg outline-none placeholder:text-faint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
              />
              {query ? (
                <button
                  type="button"
                  aria-label="Очистить поиск"
                  onClick={() => setQuery("")}
                  className="absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-md text-muted"
                >
                  <X className="size-4" />
                </button>
              ) : null}
            </label>
            {view === "iss" ? (
              <div className="flex flex-wrap gap-2">
                <Chip active={filter === "all"} onClick={() => setFilter("all")} label="Все" />
                <Chip active={filter === "file"} onClick={() => setFilter("file")} label="С файлом" />
                <Chip active={filter === "nofile"} onClick={() => setFilter("nofile")} label="Без файла" />
                <Chip
                  active={filter === "fav"}
                  onClick={() => setFilter("fav")}
                  label={favs.size ? `Избранное ${favs.size}` : "Избранное"}
                />
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Chip active={archiveFilter === "all"} onClick={() => setArchiveFilter("all")} label="Все файлы" />
                <Chip
                  active={archiveFilter === "loose"}
                  onClick={() => setArchiveFilter("loose")}
                  label={`Вне перечня ${stats.looseFiles}`}
                />
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-16" role="tree">
            {view === "iss" ? (
              topIds.some((id) => !visibleDocs || visibleDocs.has(id)) ? (
                topIds.map((id) => (
                  <DocBranch
                    key={id}
                    id={id}
                    depth={0}
                    query={query}
                    visible={visibleDocs}
                    expanded={expanded}
                    forceOpen={forceOpen}
                    selectedId={selection?.kind === "doc" ? selection.id : null}
                    favs={favs}
                    onToggle={toggleDoc}
                    onSelect={selectDoc}
                  />
                ))
              ) : (
                <EmptySearch query={query} />
              )
            ) : (
              <ArchiveBranch
                nodes={archive}
                depth={0}
                query={query}
                tokens={tokens}
                filter={archiveFilter}
                expanded={archiveExpanded}
                selected={selection}
                reveal={false}
                onToggle={(id) =>
                  setArchiveExpanded((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onSelect={(next) => {
                  setSelection(next);
                  setDetailOpen(true);
                  setCopied("");
                }}
              />
            )}
          </div>
        </section>

        <section className={cx("flex min-h-0 min-w-0 flex-1 flex-col", !detailOpen && "max-lg:hidden")}>
          <Detail
            selection={selection}
            favs={favs}
            copied={copied}
            onBack={() => setDetailOpen(false)}
            onToggleFav={toggleFav}
            onOpenDoc={selectDoc}
            onCopied={setCopied}
          />
        </section>
      </div>
    </div>
  );
}

function ViewButton({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: "library" | "archive";
}) {
  const Icon = icon === "library" ? Library : Archive;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium",
        active ? "bg-amber text-ink" : "bg-surface text-muted",
      )}
    >
      <Icon className="size-4" />
      {label}
    </button>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "min-h-11 rounded-md px-3 text-sm font-medium",
        active ? "bg-raised text-fg" : "text-muted",
      )}
    >
      {label}
    </button>
  );
}

function EmptySearch({ query }: { query: string }) {
  return (
    <p className="px-4 py-8 text-sm text-muted">
      Ничего не найдено{query.trim() ? ` по запросу «${query.trim()}»` : ""}.
    </p>
  );
}

function DocBranch({
  id,
  depth,
  query,
  visible,
  expanded,
  forceOpen,
  selectedId,
  favs,
  onToggle,
  onSelect,
}: {
  id: string;
  depth: number;
  query: string;
  visible: Set<string> | null;
  expanded: Set<string>;
  forceOpen: boolean;
  selectedId: string | null;
  favs: Set<string>;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const item = docs.get(id);
  if (!item || (visible && !visible.has(id))) return null;
  const childIds = item.childIds.filter((childId) => !visible || visible.has(childId));
  const open = childIds.length > 0 && (forceOpen || expanded.has(id));
  const selected = selectedId === id;

  return (
    <div role="group">
      <div
        role="treeitem"
        aria-expanded={childIds.length ? open : undefined}
        aria-selected={selected}
        data-doc={id}
        className={cx("flex items-stretch border-l-2", selected ? "border-amber bg-raised" : "border-transparent")}
        style={{ paddingInlineStart: `${depth * 0.75}rem` }}
      >
        {childIds.length ? (
          <button
            type="button"
            aria-label={open ? "Свернуть" : "Развернуть"}
            onClick={() => onToggle(id)}
            className="flex size-11 shrink-0 items-center justify-center text-muted"
          >
            <ChevronRight className={cx("size-4 transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="size-11 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => {
            onSelect(id);
            if (childIds.length) onToggle(id);
          }}
          className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left"
        >
          {childIds.length ? (
            open ? (
              <FolderOpen className="size-4 shrink-0 text-amber" />
            ) : (
              <Folder className="size-4 shrink-0 text-amber" />
            )
          ) : (
            <FileText className={cx("size-4 shrink-0", item.hasFile ? "text-fg" : "text-faint")} />
          )}
          <span className={cx("min-w-0 flex-1 truncate text-sm", item.hasFile ? "text-fg" : "text-muted")}>
            <Highlight text={item.node.title} query={query} />
          </span>
          {favs.has(id) ? <Star className="size-3.5 shrink-0 fill-amber text-amber" /> : null}
          {item.hasFile ? <span className="size-1.5 shrink-0 rounded-full bg-amber" aria-hidden /> : null}
        </button>
      </div>
      {open
        ? childIds.map((childId) => (
            <DocBranch
              key={childId}
              id={childId}
              depth={depth + 1}
              query={query}
              visible={visible}
              expanded={expanded}
              forceOpen={forceOpen}
              selectedId={selectedId}
              favs={favs}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))
        : null}
    </div>
  );
}

function passesArchiveFilter(node: ArchiveNode, filter: ArchiveFilter): boolean {
  if (node.fileId) return filter === "all" || looseFileIds.has(node.fileId);
  return node.children.some((child) => passesArchiveFilter(child, filter));
}

function archiveNameHit(node: ArchiveNode, tokens: string[]) {
  if (!tokens.length) return true;
  return matchesBlob(`${node.name} ${node.path}`.toLowerCase(), tokens);
}

function archiveVisible(node: ArchiveNode, tokens: string[], filter: ArchiveFilter): boolean {
  if (!passesArchiveFilter(node, filter)) return false;
  if (!tokens.length) return true;
  if (archiveNameHit(node, tokens)) return true;
  return node.children.some((child) => archiveVisible(child, tokens, filter));
}

function ArchiveBranch({
  nodes,
  depth,
  query,
  tokens,
  filter,
  expanded,
  selected,
  reveal,
  onToggle,
  onSelect,
}: {
  nodes: ArchiveNode[];
  depth: number;
  query: string;
  tokens: string[];
  filter: ArchiveFilter;
  expanded: Set<string>;
  selected: Selection | null;
  reveal: boolean;
  onToggle: (id: string) => void;
  onSelect: (selection: Selection) => void;
}) {
  const visible = nodes.filter((node) => (reveal ? passesArchiveFilter(node, filter) : archiveVisible(node, tokens, filter)));
  if (!visible.length && depth === 0) return <EmptySearch query={query} />;
  return (
    <>
      {visible.map((node) => {
        const isFile = Boolean(node.fileId);
        const nameHit = archiveNameHit(node, tokens);
        const open = !isFile && (tokens.length > 0 || expanded.has(node.id));
        const selectedRow =
          (selected?.kind === "file" && selected.id === node.fileId) ||
          (selected?.kind === "dir" && selected.id === node.id);
        return (
          <div key={node.id} role="group">
            <div
              role="treeitem"
              aria-expanded={isFile ? undefined : open}
              aria-selected={selectedRow}
              className={cx(
                "flex items-stretch border-l-2",
                selectedRow ? "border-amber bg-raised" : "border-transparent",
              )}
              style={{ paddingInlineStart: `${depth * 0.75}rem` }}
            >
              {isFile ? (
                <span className="size-11 shrink-0" />
              ) : (
                <button
                  type="button"
                  aria-label={open ? "Свернуть" : "Развернуть"}
                  onClick={() => onToggle(node.id)}
                  className="flex size-11 shrink-0 items-center justify-center text-muted"
                >
                  <ChevronRight className={cx("size-4 transition-transform", open && "rotate-90")} />
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  if (node.fileId) onSelect({ kind: "file", id: node.fileId });
                  else {
                    onToggle(node.id);
                    onSelect({
                      kind: "dir",
                      id: node.id,
                      name: node.name,
                      path: node.path,
                      count: archiveFileCount(node),
                    });
                  }
                }}
                className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 pr-3 text-left"
              >
                {isFile ? (
                  <FileText
                    className={cx(
                      "size-4 shrink-0",
                      node.fileId && looseFileIds.has(node.fileId) ? "text-faint" : "text-fg",
                    )}
                  />
                ) : open ? (
                  <FolderOpen className="size-4 shrink-0 text-amber" />
                ) : (
                  <Folder className="size-4 shrink-0 text-amber" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm">
                  <Highlight text={node.name} query={query} />
                </span>
              </button>
            </div>
            {open ? (
              <ArchiveBranch
                nodes={node.children}
                depth={depth + 1}
                query={query}
                tokens={tokens}
                filter={filter}
                expanded={expanded}
                selected={selected}
                reveal={reveal || nameHit}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function Detail({
  selection,
  favs,
  copied,
  onBack,
  onToggleFav,
  onOpenDoc,
  onCopied,
}: {
  selection: Selection | null;
  favs: Set<string>;
  copied: string;
  onBack: () => void;
  onToggleFav: (id: string) => void;
  onOpenDoc: (id: string) => void;
  onCopied: (key: string) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2 lg:hidden">
        <button type="button" onClick={onBack} className="min-h-11 rounded-md px-3 text-sm font-medium text-amber">
          К списку
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 pb-16 lg:px-8">
        {!selection ? <EmptyDetail /> : null}
        {selection?.kind === "doc" ? (
          <DocDetail
            item={docs.get(selection.id) ?? null}
            fav={favs.has(selection.id)}
            copied={copied}
            onToggleFav={() => onToggleFav(selection.id)}
            onOpenDoc={onOpenDoc}
            onCopied={onCopied}
          />
        ) : null}
        {selection?.kind === "file" ? (
          <FileDetail fileId={selection.id} copied={copied} onOpenDoc={onOpenDoc} onCopied={onCopied} />
        ) : null}
        {selection?.kind === "dir" ? (
          <div className="mx-auto max-w-3xl">
            <p className="font-mono text-xs text-faint">Папка архива</p>
            <h2 className="mt-2 text-xl font-semibold text-balance">{selection.name}</h2>
            <p className="mt-3 font-mono text-sm break-all text-muted">{selection.path}</p>
            <p className="mt-4 text-sm text-muted">Файлов внутри: {selection.count}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EmptyDetail() {
  return (
    <div className="mx-auto max-w-md pt-10">
      <p className="text-lg font-semibold text-balance">Выберите документ</p>
      <p className="mt-2 text-sm text-pretty text-muted">
        Дерево повторяет перечень ИСС. Точка у названия значит, что к карточке привязан файл из архива — путь можно
        скопировать в карточке.
      </p>
    </div>
  );
}

function DocDetail({
  item,
  fav,
  copied,
  onToggleFav,
  onOpenDoc,
  onCopied,
}: {
  item: DocIndex | null;
  fav: boolean;
  copied: string;
  onToggleFav: () => void;
  onOpenDoc: (id: string) => void;
  onCopied: (key: string) => void;
}) {
  if (!item) return null;
  const attached = docFiles(item.id);
  const isFolder = item.childIds.length > 0;
  return (
    <article className="mx-auto max-w-3xl">
      <p className="text-sm text-pretty text-muted">{item.breadcrumb.join("  /  ")}</p>
      <div className="mt-3 flex items-start gap-3">
        <h2 className="min-w-0 flex-1 text-xl font-semibold text-balance">{item.node.title}</h2>
        <button
          type="button"
          aria-pressed={fav}
          onClick={onToggleFav}
          className="flex size-11 shrink-0 items-center justify-center rounded-md bg-surface text-amber"
          aria-label={fav ? "Убрать из избранного" : "В избранное"}
        >
          <Star className={cx("size-4", fav && "fill-amber")} />
        </button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {item.node.code ? (
          <span className="rounded-md bg-surface px-3 py-2 font-mono text-sm text-amber">{item.node.code}</span>
        ) : null}
        {item.node.date ? (
          <span className="rounded-md bg-surface px-3 py-2 font-mono text-sm text-muted">{item.node.date}</span>
        ) : null}
        <span className="rounded-md bg-surface px-3 py-2 text-sm text-muted">
          {attached.length ? "Файл в архиве" : isFolder ? "Раздел" : "Файла в выгрузке нет"}
        </span>
      </div>
      {isFolder ? (
        <p className="mt-4 text-sm text-muted">
          В разделе {item.leafCount} документов, с файлом {item.linkedLeafCount}.
        </p>
      ) : null}
      <FileList files={attached} copied={copied} onCopied={onCopied} onOpenDoc={onOpenDoc} skipDocId={item.id} />
    </article>
  );
}

function FileDetail({
  fileId,
  copied,
  onOpenDoc,
  onCopied,
}: {
  fileId: string;
  copied: string;
  onOpenDoc: (id: string) => void;
  onCopied: (key: string) => void;
}) {
  const file = fileById.get(fileId);
  if (!file) return null;
  return (
    <article className="mx-auto max-w-3xl">
      <p className="font-mono text-xs text-faint">Файл архива</p>
      <h2 className="mt-2 text-xl font-semibold text-balance">{file.name}</h2>
      <FileList files={[file]} copied={copied} onCopied={onCopied} onOpenDoc={onOpenDoc} />
    </article>
  );
}

function FileList({
  files: attached,
  copied,
  onCopied,
  onOpenDoc,
  skipDocId,
}: {
  files: { id: string; name: string; path: string }[];
  copied: string;
  onCopied: (key: string) => void;
  onOpenDoc: (id: string) => void;
  skipDocId?: string;
}) {
  if (!attached.length) {
    return (
      <p className="mt-6 text-sm text-pretty text-muted">
        В приложенной выгрузке архива для этой карточки файл не нашёлся. Сам пункт перечня на месте.
      </p>
    );
  }
  return (
    <ul className="mt-6 space-y-3">
      {attached.map((file) => {
        const places = placements(file.id).filter((place) => place.id !== skipDocId);
        return (
          <li key={file.id} className="rounded-md border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium break-all">{file.name}</p>
                <p className="mt-2 font-mono text-sm break-all text-muted">{file.path}</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  const ok = await copyText(file.path);
                  onCopied(ok ? file.id : "");
                }}
                className="flex min-h-11 shrink-0 items-center gap-2 rounded-md bg-amber px-3 text-sm font-medium text-ink"
              >
                <Copy className="size-4" />
                {copied === file.id ? "Скопировано" : "Путь"}
              </button>
            </div>
            {places.length ? (
              <div className="mt-4 border-t border-line pt-3">
                <p className="text-xs text-faint">Также в перечне</p>
                <ul className="mt-2 space-y-1">
                  {places.slice(0, 6).map((place) => (
                    <li key={place.id}>
                      <button
                        type="button"
                        onClick={() => onOpenDoc(place.id)}
                        className="w-full rounded-md px-2 py-2 text-left text-sm text-muted hover:bg-raised hover:text-fg"
                      >
                        <span className="line-clamp-2">{place.breadcrumb.slice(-2).join(" / ")}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {places.length > 6 ? <p className="mt-1 text-xs text-faint">Ещё {places.length - 6}</p> : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
