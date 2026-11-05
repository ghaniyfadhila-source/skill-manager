import path from "node:path";
import { isPathInside } from "./guard.js";
import {
  type DirEntry,
  type FileStat,
  type FileSystem,
  type FsResult,
  fsErr,
  fsOk,
  type MkdirOptions,
  type RemoveOptions,
  type SymlinkOptions,
  type WriteOptions,
} from "./types.js";

interface MemoryNode {
  kind: "file" | "directory" | "symlink";
  data?: Uint8Array;
  /** Target mentah seperti yang diberikan ke symlink(). */
  target?: string;
  mode: number;
  mtimeMs: number;
}

const FILE_MODE = 0o644;
const DIRECTORY_MODE = 0o755;
const LINK_MODE = 0o777;

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
}

function entryKind(node: MemoryNode): "file" | "directory" | "other" {
  return node.kind === "file" || node.kind === "directory" ? node.kind : "other";
}

/**
 * FileSystem in-memory untuk unit test. Semantik mengikuti NodeFileSystem:
 * tautan diikuti untuk operasi baca, sedangkan remove memeriksa tautan per
 * entri dan tidak pernah menghapus targetnya.
 */
export class MemoryFileSystem implements FileSystem {
  private readonly nodes = new Map<string, MemoryNode>();

  constructor() {
    const root = path.parse(path.resolve(path.sep)).root;
    this.nodes.set(root, {
      kind: "directory",
      mode: DIRECTORY_MODE,
      mtimeMs: 0,
    });
  }

  /** Ubah mtime sebuah entri; hanya tersedia di implementasi memori untuk test hash. */
  setMtime(targetPath: string, mtimeMs: number): FsResult<void> {
    const resolved = this.resolvePath(targetPath, true);
    if (!resolved.ok) {
      return resolved;
    }
    resolved.value.node.mtimeMs = mtimeMs;
    return fsOk(undefined);
  }

  async read(targetPath: string): Promise<FsResult<Uint8Array>> {
    const resolved = this.resolvePath(targetPath, true);
    if (!resolved.ok) {
      return resolved;
    }
    if (resolved.value.node.kind === "directory") {
      return fsErr("is_a_directory", targetPath, "Path adalah direktori, bukan file.");
    }
    return fsOk(new Uint8Array(resolved.value.node.data ?? new Uint8Array()));
  }

  async readText(targetPath: string): Promise<FsResult<string>> {
    const bytes = await this.read(targetPath);
    if (!bytes.ok) {
      return bytes;
    }
    try {
      return fsOk(new TextDecoder("utf-8", { fatal: true }).decode(bytes.value));
    } catch (error) {
      return fsErr("invalid_utf8", targetPath, "Isi file bukan UTF-8 yang valid.", error);
    }
  }

  async write(
    targetPath: string,
    data: Uint8Array | string,
    options?: WriteOptions,
  ): Promise<FsResult<void>> {
    const target = await this.resolveForWrite(targetPath);
    if (!target.ok) {
      return target;
    }
    const existing = this.nodes.get(target.value);
    if (existing?.kind === "directory") {
      return fsErr("is_a_directory", targetPath, "Tidak bisa menulis ke direktori.");
    }
    this.nodes.set(target.value, {
      kind: "file",
      data: toBytes(data),
      mode: options?.mode ?? existing?.mode ?? FILE_MODE,
      mtimeMs: Date.now(),
    });
    return fsOk(undefined);
  }

  async copy(source: string, destination: string): Promise<FsResult<void>> {
    const sourceReal = this.resolvePath(source, true);
    if (!sourceReal.ok) {
      return sourceReal;
    }
    const destinationParent = this.resolvePath(path.dirname(path.resolve(destination)), true);
    if (!destinationParent.ok) {
      return destinationParent;
    }
    const destinationKey = path.join(
      destinationParent.value.path,
      path.basename(path.resolve(destination)),
    );
    if (this.nodes.has(destinationKey)) {
      return fsErr("already_exists", destination, "Tujuan copy sudah ada.");
    }
    if (isPathInside(sourceReal.value.path, destinationParent.value.path)) {
      return fsErr("invalid_path", destination, "Tidak bisa menyalin direktori ke dalam dirinya.");
    }
    return this.copyEntry(sourceReal.value.path, destinationKey, sourceReal.value.path, new Set());
  }

  async remove(targetPath: string, options?: RemoveOptions): Promise<FsResult<void>> {
    const absolute = path.resolve(targetPath);
    const parent = this.resolvePath(path.dirname(absolute), true);
    if (!parent.ok) {
      return parent;
    }
    const key = path.join(parent.value.path, path.basename(absolute));
    return this.removeKey(key, options?.recursive === true);
  }

  async realpath(targetPath: string): Promise<FsResult<string>> {
    const resolved = this.resolvePath(targetPath, true);
    return resolved.ok ? fsOk(resolved.value.path) : resolved;
  }

  async stat(targetPath: string): Promise<FsResult<FileStat>> {
    const resolved = this.resolvePath(targetPath, true);
    if (!resolved.ok) {
      return resolved;
    }
    return fsOk(this.toStat(resolved.value.node));
  }

  async lstat(targetPath: string): Promise<FsResult<FileStat>> {
    const resolved = this.resolvePath(targetPath, false);
    if (!resolved.ok) {
      return resolved;
    }
    return fsOk(this.toStat(resolved.value.node));
  }

  async readdir(targetPath: string): Promise<FsResult<DirEntry[]>> {
    const resolved = this.resolvePath(targetPath, true);
    if (!resolved.ok) {
      return resolved;
    }
    if (resolved.value.node.kind !== "directory") {
      return fsErr("not_a_directory", targetPath, "Path bukan direktori.");
    }
    const entries: DirEntry[] = [];
    for (const childKey of this.childKeys(resolved.value.path)) {
      const node = this.nodes.get(childKey);
      if (!node) {
        continue;
      }
      const name = path.basename(childKey);
      if (node.kind !== "symlink") {
        entries.push({ name, kind: entryKind(node), isSymlink: false });
        continue;
      }
      const target = this.resolvePath(childKey, true);
      entries.push({
        name,
        kind: target.ok ? entryKind(target.value.node) : "dangling",
        isSymlink: true,
      });
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    return fsOk(entries);
  }

  async mkdir(targetPath: string, options?: MkdirOptions): Promise<FsResult<void>> {
    const absolute = path.resolve(targetPath);
    if (options?.recursive !== true) {
      const parent = this.resolvePath(path.dirname(absolute), true);
      if (!parent.ok) {
        return parent;
      }
      const key = path.join(parent.value.path, path.basename(absolute));
      if (this.nodes.has(key)) {
        return fsErr("already_exists", targetPath, "Direktori sudah ada.");
      }
      this.nodes.set(key, this.directoryNode());
      return fsOk(undefined);
    }

    let current = path.parse(absolute).root;
    const relative = path.relative(current, absolute);
    for (const segment of relative === "" ? [] : relative.split(path.sep)) {
      const candidate = path.join(current, segment);
      const existing = this.nodes.get(candidate);
      if (existing) {
        if (existing.kind === "symlink") {
          const target = this.resolvePath(candidate, true);
          if (!target.ok) {
            return target;
          }
          if (target.value.node.kind !== "directory") {
            return fsErr("not_a_directory", targetPath, "Komponen path bukan direktori.");
          }
          current = target.value.path;
          continue;
        }
        if (existing.kind !== "directory") {
          return fsErr("not_a_directory", targetPath, "Komponen path bukan direktori.");
        }
      } else {
        this.nodes.set(candidate, this.directoryNode());
      }
      current = candidate;
    }
    return fsOk(undefined);
  }

  async rename(from: string, to: string): Promise<FsResult<void>> {
    const absoluteFrom = path.resolve(from);
    const fromParent = this.resolvePath(path.dirname(absoluteFrom), true);
    if (!fromParent.ok) {
      return fromParent;
    }
    const fromKey = path.join(fromParent.value.path, path.basename(absoluteFrom));
    const fromNode = this.nodes.get(fromKey);
    if (!fromNode) {
      return fsErr("not_found", from, "Sumber rename tidak ditemukan.");
    }

    const absoluteTo = path.resolve(to);
    const toParent = this.resolvePath(path.dirname(absoluteTo), true);
    if (!toParent.ok) {
      return toParent;
    }
    const toKey = path.join(toParent.value.path, path.basename(absoluteTo));
    if (fromKey === toKey) {
      return fsOk(undefined);
    }
    const toNode = this.nodes.get(toKey);
    if (toNode) {
      if (fromNode.kind === "directory" || toNode.kind === "directory") {
        return fsErr("already_exists", to, "Tujuan rename sudah ada.");
      }
      this.nodes.delete(toKey);
    }
    if (fromNode.kind === "directory" && isPathInside(fromKey, toKey)) {
      return fsErr("invalid_path", to, "Tidak bisa memindahkan direktori ke dalam dirinya.");
    }

    const moved = [...this.nodes.entries()].filter(
      ([key]) => key === fromKey || key.startsWith(`${fromKey}${path.sep}`),
    );
    for (const [key, node] of moved) {
      this.nodes.delete(key);
      this.nodes.set(`${toKey}${key.slice(fromKey.length)}`, node);
    }
    return fsOk(undefined);
  }

  async exists(targetPath: string): Promise<boolean> {
    return this.resolvePath(targetPath, false).ok;
  }

  async readlink(targetPath: string): Promise<FsResult<string>> {
    const resolved = this.resolvePath(targetPath, false);
    if (!resolved.ok) {
      return resolved;
    }
    if (resolved.value.node.kind !== "symlink") {
      return fsErr("invalid_path", targetPath, "Path bukan tautan.");
    }
    return fsOk(resolved.value.node.target ?? "");
  }

  async symlink(
    target: string,
    linkPath: string,
    _options?: SymlinkOptions,
  ): Promise<FsResult<void>> {
    const absolute = path.resolve(linkPath);
    const parent = this.resolvePath(path.dirname(absolute), true);
    if (!parent.ok) {
      return parent;
    }
    const key = path.join(parent.value.path, path.basename(absolute));
    if (this.nodes.has(key)) {
      return fsErr("already_exists", linkPath, "Tautan tujuan sudah ada.");
    }
    this.nodes.set(key, {
      kind: "symlink",
      target,
      mode: LINK_MODE,
      mtimeMs: Date.now(),
    });
    return fsOk(undefined);
  }

  private directoryNode(): MemoryNode {
    return { kind: "directory", mode: DIRECTORY_MODE, mtimeMs: Date.now() };
  }

  private toStat(node: MemoryNode): FileStat {
    const kind = node.kind;
    const size =
      node.kind === "file"
        ? (node.data?.byteLength ?? 0)
        : node.kind === "symlink"
          ? (node.target?.length ?? 0)
          : 0;
    return { kind, size, mode: node.mode, mtimeMs: node.mtimeMs };
  }

  private childKeys(directory: string): string[] {
    const prefix = directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`;
    return [...this.nodes.keys()].filter((key) => {
      if (!key.startsWith(prefix)) {
        return false;
      }
      return !key.slice(prefix.length).includes(path.sep);
    });
  }

  private resolvePath(
    input: string,
    followFinal: boolean,
    visited: Set<string> = new Set(),
  ): FsResult<{ path: string; node: MemoryNode; isSymlink: boolean }> {
    const absolute = path.resolve(input);
    const root = path.parse(absolute).root;
    let current = root;
    let node = this.nodes.get(root);
    if (!node) {
      return fsErr("not_found", input, "Akar filesystem tidak dikenal.");
    }
    const relative = path.relative(root, absolute);
    const segments = relative === "" ? [] : relative.split(path.sep);

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] ?? "";
      const candidate = path.join(current, segment);
      const next = this.nodes.get(candidate);
      const last = index === segments.length - 1;
      if (!next) {
        return fsErr("not_found", input, "Path tidak ditemukan.");
      }
      if (next.kind === "symlink" && (followFinal || !last)) {
        if (visited.has(candidate)) {
          return fsErr("symlink_loop", input, "Tautan berputar.");
        }
        visited.add(candidate);
        const target = path.resolve(path.dirname(candidate), next.target ?? "");
        const resolved = this.resolvePath(target, true, visited);
        if (!resolved.ok) {
          return resolved;
        }
        node = resolved.value.node;
        current = resolved.value.path;
        if (!last && node.kind !== "directory") {
          return fsErr("not_a_directory", input, "Komponen path bukan direktori.");
        }
        continue;
      }
      node = next;
      current = candidate;
      if (last) {
        return { ok: true, value: { path: current, node, isSymlink: next.kind === "symlink" } };
      }
      if (next.kind !== "directory") {
        return fsErr("not_a_directory", input, "Komponen path bukan direktori.");
      }
    }

    return fsOk({ path: current, node, isSymlink: node.kind === "symlink" });
  }

  /** Menentukan path akhir untuk write, mengikuti tautan final (termasuk menggantung). */
  private async resolveForWrite(input: string): Promise<FsResult<string>> {
    const absolute = path.resolve(input);
    const parent = this.resolvePath(path.dirname(absolute), true);
    if (!parent.ok) {
      return parent;
    }
    let current = path.join(parent.value.path, path.basename(absolute));
    const visited = new Set<string>();
    while (true) {
      const node = this.nodes.get(current);
      if (node?.kind !== "symlink") {
        return fsOk(current);
      }
      if (visited.has(current)) {
        return fsErr("symlink_loop", input, "Tautan berputar.");
      }
      visited.add(current);
      const target = path.resolve(path.dirname(current), node.target ?? "");
      const targetParent = this.resolvePath(path.dirname(target), true);
      if (!targetParent.ok) {
        return targetParent;
      }
      current = path.join(targetParent.value.path, path.basename(target));
    }
  }

  private copyEntry(
    sourceKey: string,
    destinationKey: string,
    sourceRoot: string,
    activeDirectories: Set<string>,
  ): FsResult<void> {
    const node = this.nodes.get(sourceKey);
    if (!node) {
      return fsErr("not_found", sourceKey, "Sumber copy tidak ditemukan.");
    }
    if (node.kind === "symlink") {
      const resolved = this.resolvePath(sourceKey, true);
      if (!resolved.ok) {
        return fsErr(
          "unsafe_symlink",
          sourceKey,
          "Tautan di dalam sumber tidak bisa disalin karena targetnya tidak ada.",
          resolved.error,
        );
      }
      if (!isPathInside(sourceRoot, resolved.value.path)) {
        return fsErr(
          "unsafe_symlink",
          sourceKey,
          "Tautan di dalam sumber menunjuk keluar dari folder sumber.",
        );
      }
      return this.copyEntry(resolved.value.path, destinationKey, sourceRoot, activeDirectories);
    }

    if (this.nodes.has(destinationKey)) {
      return fsErr("already_exists", destinationKey, "Tujuan copy sudah ada.");
    }

    if (node.kind === "file") {
      this.nodes.set(destinationKey, {
        kind: "file",
        data: new Uint8Array(node.data ?? new Uint8Array()),
        mode: node.mode,
        mtimeMs: Date.now(),
      });
      return fsOk(undefined);
    }

    if (activeDirectories.has(sourceKey)) {
      return fsErr("symlink_loop", sourceKey, "Siklus direktori saat copy.");
    }
    activeDirectories.add(sourceKey);
    this.nodes.set(destinationKey, this.directoryNode());
    for (const childKey of this.childKeys(sourceKey)) {
      const copied = this.copyEntry(
        childKey,
        path.join(destinationKey, path.basename(childKey)),
        sourceRoot,
        activeDirectories,
      );
      if (!copied.ok) {
        activeDirectories.delete(sourceKey);
        return copied;
      }
    }
    activeDirectories.delete(sourceKey);
    return fsOk(undefined);
  }

  private removeKey(key: string, recursive: boolean): FsResult<void> {
    const node = this.nodes.get(key);
    if (!node) {
      return fsErr("not_found", key, "Path tidak ditemukan.");
    }
    if (node.kind !== "directory") {
      this.nodes.delete(key);
      return fsOk(undefined);
    }
    if (key === path.parse(key).root) {
      return fsErr("invalid_path", key, "Tidak bisa menghapus akar filesystem.");
    }
    const children = this.childKeys(key);
    if (children.length > 0 && !recursive) {
      return fsErr("not_empty", key, "Direktori tidak kosong; gunakan recursive.");
    }
    for (const childKey of children) {
      const child = this.nodes.get(childKey);
      if (!child) {
        continue;
      }
      if (child.kind === "symlink") {
        this.nodes.delete(childKey);
        continue;
      }
      const removed = this.removeKey(childKey, true);
      if (!removed.ok) {
        return removed;
      }
    }
    this.nodes.delete(key);
    return fsOk(undefined);
  }
}
