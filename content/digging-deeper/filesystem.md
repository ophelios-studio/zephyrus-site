---
title: Filesystem
order: 6
description: Read, write, copy and list files and directories with File and Directory, and keep a user-supplied path out of them.
---

# Filesystem

Files and directories as objects.

`File` and `Directory` wrap PHP's filesystem functions. A failure throws a `FileSystemException` instead of returning `false`, files the class creates get predictable permissions, and a write removes a symbolic link found at the destination instead of following it.

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

A file that `File` creates (`create()`, `write()` or `copy()` onto a path that did not exist) gets `File::DEFAULT_PERMISSIONS`, `0644`, narrowed by the process umask: the mode is never wider than the umask allows. Under `umask(0077)` a file made by `File::create()` is `0600`, as with `file_put_contents()`, and under `umask(0022)` it is `0644`. A new copy is also never wider than its source: copying a `0600` file gives a `0600` file. A copy onto an existing destination keeps that file's permissions. Version 0.14.0 forced `0644` whatever the umask or the source.

Before writing, `create()`, `write()` and `copy()` remove a symbolic link they find at the destination and write a regular file in its place. The check and the write are two steps, so it is not a guarantee against someone racing you in a directory they can write to. `append()` still follows a link.

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

`delete(true)` removes the content first and throws on the first entry it cannot remove, so a partial purge is never reported as success. A symbolic link inside is unlinked, never followed: the target survives. Deleting a path that is itself a symbolic link, live or dangling, removes only the link, with or without `true`: its target survives. Version 0.14.0 emptied the target of a live link, then threw. `delete()` without `true` on a directory that still has content throws `Failed to delete directory: <path>`.

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

## Paths that come from a request

`File` and `Directory` act on whatever path they are given: `../../etc/passwd` climbs out of a base directory, and so does a symbolic link inside it. Never join request input to a base path. Either:

- store under a name you generate, as the uploader does (see [Uploads](../uploads/)), and keep the mapping from the client's name in your database;
- or constrain the route parameter strictly, so that nothing but a plain file name can arrive:

```php
namespace App\Controllers;

use Zephyrus\Controller\Controller;
use Zephyrus\FileSystem\File;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Get;
use Zephyrus\Routing\Attribute\Middleware;

#[Middleware('auth')]
final class ExportController extends Controller
{
    #[Get('/exports/{name}', constraints: ['name' => '[A-Za-z0-9_-]+\.csv'])]
    public function download(string $name): Response
    {
        $file = new File(dirname(__DIR__, 2) . '/storage/exports/' . $name);
        if (!$file->exists()) {
            return $this->text('Not found', 404);
        }

        return new Response($file->read(), 200, [
            'Content-Type' => 'text/csv',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
```

The pattern has no slash and no dot except the extension, so the name cannot name another directory.

The constraint checks the name, not who may read the file: the `auth` middleware (see [Authentication](../../fundamentals/authentication/)) keeps the exports for signed-in users, and an export that belongs to one account must also be checked against the current user.

## Good to know

- **A path from a request is untrusted.** Generate the name yourself, or constrain the route parameter strictly, before it reaches `File` or `Directory`.
- **`delete(true)` is final.** A recursive delete of a wrong path removes everything under it. Build the path from your own constants.
- **`move()` and `copy()` overwrite the destination.** Check `exists()` first when that matters.
- **`glob()` and `recursiveGlob()` return strings**, `files()` and `directories()` return objects.
- **The permissions apply to new files only.** An existing file keeps its mode when you `write()` to it.
