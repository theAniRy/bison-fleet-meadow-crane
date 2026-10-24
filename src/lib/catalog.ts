import raw from "../data/catalog.json";

export type CatalogNode = {
  id: string;
  title: string;
  code?: string;
  date?: string;
  fileIds?: string[];
  children?: CatalogNode[];
};

export type CatalogFile = {
  id: string;
  name: string;
  path: string;
};

export type DocIndex = {
  id: string;
  node: CatalogNode;
  depth: number;
  ancestors: string[];
  breadcrumb: string[];
  childIds: string[];
  hasFile: boolean;
  leafCount: number;
  linkedLeafCount: number;
  blob: string;
};

export type ArchiveNode = {
  id: string;
  name: string;
  path: string;
  fileId?: string;
  children: ArchiveNode[];
};

const data = raw as {
  tree: CatalogNode[];
  files: CatalogFile[];
};

export const files: CatalogFile[] = data.files;
export const fileById = new Map(files.map((file) => [file.id, file]));

export const docs = new Map<string, DocIndex>();
const filePlacements = new Map<string, string[]>();

function fileBlob(ids: string[] | undefined): string {
  if (!ids?.length) return "";
  return ids
    .map((id) => {
      const file = fileById.get(id);
      return file ? `${file.name} ${file.path}` : "";
    })
    .join(" ");
}

function visit(
  node: CatalogNode,
  depth: number,
  ancestors: string[],
  breadcrumb: string[],
): DocIndex {
  const children = (node.children ?? []).map((child) =>
    visit(child, depth + 1, [...ancestors, node.id], [...breadcrumb, node.title]),
  );
  const isLeaf = children.length === 0;
  const hasFile = (node.fileIds?.length ?? 0) > 0;
  const item: DocIndex = {
    id: node.id,
    node,
    depth,
    ancestors,
    breadcrumb,
    childIds: children.map((child) => child.id),
    hasFile,
    leafCount: isLeaf ? 1 : children.reduce((sum, child) => sum + child.leafCount, 0),
    linkedLeafCount: isLeaf
      ? hasFile
        ? 1
        : 0
      : children.reduce((sum, child) => sum + child.linkedLeafCount, 0),
    blob: [node.title, node.code ?? "", node.date ?? "", fileBlob(node.fileIds)]
      .join(" ")
      .toLowerCase(),
  };
  docs.set(node.id, item);
  for (const fileId of node.fileIds ?? []) {
    const list = filePlacements.get(fileId) ?? [];
    list.push(node.id);
    filePlacements.set(fileId, list);
  }
  return item;
}

for (const node of data.tree) visit(node, 0, [], []);

const root = data.tree[0];
export const topIds = root ? (docs.get(root.id)?.childIds ?? []) : [];

export function placements(fileId: string): DocIndex[] {
  return (filePlacements.get(fileId) ?? [])
    .map((id) => docs.get(id))
    .filter((item): item is DocIndex => Boolean(item));
}

export function docFiles(id: string): CatalogFile[] {
  const item = docs.get(id);
  if (!item?.node.fileIds) return [];
  return item.node.fileIds
    .map((fileId) => fileById.get(fileId))
    .filter((file): file is CatalogFile => Boolean(file));
}

export const looseFileIds = new Set(files.filter((file) => !filePlacements.has(file.id)).map((file) => file.id));

export const stats = {
  sections: topIds.length,
  leaves: [...docs.values()].filter((item) => item.childIds.length === 0).length,
  linkedLeaves: [...docs.values()].filter((item) => item.childIds.length === 0 && item.hasFile).length,
  files: files.length,
  linkedFiles: files.length - looseFileIds.size,
  looseFiles: looseFileIds.size,
};

function sortArchive(nodes: ArchiveNode[]): ArchiveNode[] {
  return nodes
    .map((node) => ({ ...node, children: sortArchive(node.children) }))
    .sort((a, b) => {
      const aDir = a.children.length > 0 || !a.fileId;
      const bDir = b.children.length > 0 || !b.fileId;
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.name.localeCompare(b.name, "ru");
    });
}

function buildArchive(): ArchiveNode[] {
  const rootDir: ArchiveNode = { id: "", name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = rootDir;
    let acc = "";
    parts.forEach((part, index) => {
      acc = acc ? `${acc}/${part}` : part;
      const last = index === parts.length - 1;
      let child = current.children.find((item) => item.name === part);
      if (!child) {
        child = {
          id: last ? file.id : `dir:${acc}`,
          name: part,
          path: acc,
          fileId: last ? file.id : undefined,
          children: [],
        };
        current.children.push(child);
      }
      current = child;
    });
  }
  const docsNode = rootDir.children.find((node) => node.name === "docs");
  return sortArchive(docsNode ? docsNode.children : rootDir.children);
}

export const archive = buildArchive();

export function archiveFileCount(node: ArchiveNode): number {
  if (node.fileId) return 1;
  return node.children.reduce((sum, child) => sum + archiveFileCount(child), 0);
}
