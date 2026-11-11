---
title: Filesystem
order: 6
description: Read, write, copy and list files and directories with File and Directory, and keep a user-supplied path inside a base directory with SafePath.
---

# Filesystem

Files and directories as objects.

`File` and `Directory` wrap PHP's filesystem functions. A failure throws a `FileSystemException` instead of returning `false`, files the class creates get predictable permissions, and a write never follows a symbolic link someone planted at the destination.

## Files

```php
use Zephyrus\FileSystem\File;

$file = File::create($root . '/storage/reports/2026.txt', "alpha\nbeta\n");

$file->read();      // "alpha\nbeta\n"
$file->lines();     // ['alpha', 'beta']
$file->append("gamma\n");
$file->write("replaced\n");
```

`File::create($path, $content = '')` makes the file, and any missing parent directory, and returns a `File`. To wrap a file that exists, or may not exist yet, use `new File($path)`.

| Method | What it does |
|---|---|
| `read()` | The whole content, as a string. |
| `lines($trimNewlines = true)` | The content as a list of lines. |
| `write($content)` | Replaces the content. |
| `append($content)` | Adds to the end. |
| `size()` | The size in bytes. |
| `mimeType()` | The media type detected from the content: `text/plain` for the file above. |
| `extension()` | The extension without the dot, `txt`. |
| `hash($algo = 'sha256')` | The hash of the content: 64 hex characters for `sha256`. |
| `copy($destination)` | Copies the file and returns the new `File`. Missing directories are created. |
| `move($destination)` | Renames or moves the file and returns the `File` at the new place. |
| `delete()` | Deletes the file. Nothing happens when it is already gone. |

`copy()` and `move()` return the file at the destination. The source object from before `move()` reports `exists()` as `false`:

```php
$copy = $file->copy($root . '/storage/archive/2026-copy.txt');
$moved = $copy->move($root . '/storage/archive/2027.txt');
```

A file that `File` creates (`create()`, `write()` or `copy()` onto a path that did not exist) gets the mode `File::DEFAULT_PERMISSIONS`, `0644`, whatever the process umask. `create()`, `write()` and `copy()` replace a symbolic link at the destination with a regular file instead of following it, so a link planted at a predictable path cannot redirect your write. `append()` still follows a link.

## Directories

```php
use Zephyrus\FileSystem\Directory;

$archive = Directory::ensure($root . '/storage/archive');

$archive->files('*.txt');       // File[] (this directory only)
$archive->directories();        // Directory[] (immediate subdirectories)
$archive->glob('*.csv');        // list of paths (this directory only)
$archive->recursiveGlob('*.csv'); // list of paths (every level)
```

`Directory::ensure($path, $permissions = 0755)` creates the directory, with its parents, when it is missing, and returns it. `new Directory($path)` only wraps a path.

| Method | What it does |
|---|---|
| `files($pattern = '*')` | The files directly inside, as `File` objects. |
| `directories()` | The immediate subdirectories, as `Directory` objects. |
| `glob($pattern)` | Paths matching a glob pattern in this directory. |
| `recursiveGlob($pattern)` | Paths matching the pattern at every depth. |
| `create($permissions = 0755)` | Creates the directory when it does not exist. |
| `delete($recursive = false)` | Removes it. A non-empty directory needs `true`. |
| `size()` | The total size of every file inside, in bytes. |
| `isEmpty()` | Whether it holds nothing. |

With an `archive` directory holding `2027.txt`, `a.csv` and `deep/b.csv`, those calls gave `2027.txt`, `deep`, one path and two paths. `size()` was `9` and `isEmpty()` was `false`.

`delete(true)` removes the content first and throws on the first entry it cannot remove, so a partial purge is never reported as success. A symbolic link inside is unlinked, never followed: the target survives. `delete()` without `true` on a directory that still has content throws `Failed to delete directory: <path>`.

## What a node knows

`File` and `Directory` share the base class `FileSystemNode`:

| Method | What it returns |
|---|---|
| `path()` | The path as given. |
| `name()` | The last segment, `2026.txt`. |
| `parent()` | The path of the parent directory. |
| `exists()` | Whether the path exists on disk. |
| `isReadable()`, `isWritable()` | The matching PHP checks. |
| `permissions()` | The mode as an integer: `decoct($file->permissions())` is `644`. |
| `lastModified()` | The modification time as a Unix timestamp. |

You do not instantiate `FileSystemNode` yourself.

## Errors

Every failure is a `FileSystemException`. Its messages name the path:

```php
use Zephyrus\FileSystem\FileSystemException;

try {
    $text = (new File($root . '/storage/missing.txt'))->read();
} catch (FileSystemException $e) {
    // Path not found: /var/www/storage/missing.txt
}
```

Other messages are `Path is not readable: ...`, `Path is not writable: ...`, `Path already exists: ...` and `Failed to <operation>: ...`, for example `Failed to delete directory: ...`. They hold server paths: log them, never send them to a client.

Methods that need an existing file (`read()`, `size()`, `lines()`, `copy()`, `move()`, `permissions()`...) throw `Path not found` when it is missing. `exists()` never throws.

## Keep a path inside a base directory

When part of a path comes from a request, joining it to a base directory is not enough: `../../etc/passwd` climbs out, and so does a symbolic link inside the base that points elsewhere. `SafePath` resolves a relative path under a trusted root and refuses anything that escapes it:

```php
use Zephyrus\FileSystem\SafePath;

$name = $request->query('file');
$path = is_string($name) ? SafePath::within($root . '/storage/exports', $name) : null;

if ($path === null) {
    return $this->text('Not found', 404);
}
```

`within($root, $relativePath)` returns the canonical absolute path, or `null` when:

- the path is empty, holds a null byte, or has a `..` segment (`../fs.php` and `reports/../../fs.php` gave `null`);
- the file does not exist or is not readable (`null` for a name that is not there);
- the real path, after symbolic links are resolved, is not under the root (a link inside the root pointing to its parent gave `null`).

A leading slash is ignored: `/reports/2026.txt` resolves under the root like `reports/2026.txt`. `SafePath::isSafeRelativePath($path)` is the lexical check alone: it answers `false` for an empty path, a null byte or a `..` segment, and it does not look at the disk.

Because the file must exist, `within()` is for reading what is already there. To decide where a new file goes, generate the name yourself, as the uploader does (see [Uploads](../uploads/)), instead of accepting a path.

The framework uses `SafePath` for its own checks (view names, asset paths). The class is tagged `@internal` in the source, so it does not carry the stability promise of the others on this page: call it from one place in your application and you will only have one line to change.

## Good to know

- **A path from a request is untrusted.** Resolve it with `SafePath::within()`, or generate the name yourself, before it reaches `File` or `Directory`: they act on whatever path they are given.
- **`delete(true)` is final.** A recursive delete of a wrong path removes everything under it. Build the path from your own constants.
- **`move()` and `copy()` overwrite the destination.** Check `exists()` first when that matters.
- **`glob()` and `recursiveGlob()` return strings**, `files()` and `directories()` return objects.
- **The permissions apply to new files only.** An existing file keeps its mode when you `write()` to it.
