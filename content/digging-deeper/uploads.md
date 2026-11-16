---
title: Uploads
order: 5
description: Receive files from a form, check them against their real bytes, store them under a generated name, and serve them back safely.
---

# Uploads

Files from strangers, handled with care.

An upload is the least trustworthy input a form can send: the file name, the declared type and the size all come from the client. The `Uploader` class decides from the file itself, and stores it under a name your code or the framework generates.

The module needs the `fileinfo` PHP extension, which detects the real media type from a file's bytes. Enable it in every PHP image you run.

## Receive and store a file

A form that sends a file must be a `multipart/form-data` form, and like every form that posts it carries the CSRF field (see [Security](../../fundamentals/security/)):

```latte
<form method="post" action="/avatar" enctype="multipart/form-data">
    <input type="hidden" name="_csrf_token" value="{csrfToken()}">
    <input type="file" name="avatar" accept="image/png,image/jpeg,image/webp">
    <button>Upload</button>
</form>
```

In the controller, `$request->file('avatar')` returns a `FileUpload`, or `null` when the field is absent. Hand it to an `Uploader`:

```php
use Zephyrus\Http\Request;
use Zephyrus\Http\Response;
use Zephyrus\Routing\Attribute\Post;
use Zephyrus\Upload\UploadException;
use Zephyrus\Upload\Uploader;

#[Post('/avatar')]
public function store(Request $request): Response
{
    $file = $request->file('avatar');
    if ($file === null) {
        return $this->text('Choose a file.', 422);
    }

    try {
        $path = self::uploader()->store($file, 'avatars');
    } catch (UploadException) {
        return $this->text('This file cannot be accepted. Send a PNG, JPEG or WebP image of 5 MB or less.', 422);
    }

    return $this->json(['path' => $path], 201);
}

private static function uploader(): Uploader
{
    return new Uploader(
        dirname(__DIR__, 2) . '/storage/uploads',
        allowedExtensions: ['jpg', 'jpeg', 'png', 'webp'],
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
        maxSizeBytes: 5 * 1024 * 1024,
    );
}
```

`store()` returns the path of the stored file **relative to the root** you gave the uploader, such as `avatars/0df8ce82f4ef8e35e515a08b17aaf6b7.png`. Keep that value (in a database column, for example) and build the full path from your root when you need it. The sub-directory (`'avatars'`) is created when it does not exist.

The answer to the visitor is a fixed sentence. The `UploadException` message names server paths and the detected type: log it if you want it, but never send it to the client.

A multiple field (`<input type="file" name="photos[]" multiple>`) reads with `$request->filesOf('photos')`, a list of `FileUpload`. `storeMany($files, $subDirectory)` stores them in order and returns the list of relative paths. It stops at the first file that fails and leaves the earlier ones in place:

```php
$paths = self::uploader()->storeMany($request->filesOf('photos'), 'photos');
```

## What is checked, and against what

Nothing the browser says decides the outcome:

| Check | Done against |
|---|---|
| `allowedMimeTypes` | The type detected from the file's bytes, not the `Content-Type` the browser sent. |
| `maxSizeBytes` | The real size of the temporary file. |
| `allowedExtensions` | Every dotted segment of the client's file name: `avatar.php.png` is refused because of `php`. |
| Where it lands | The destination must stay under the root, once symbolic links are resolved. A `..` segment in the sub-directory is refused. |

A PHP file sent under the name `shell.png` is refused on its detected type, with `Upload MIME type "text/x-php" is not allowed. Allowed MIME types: image/jpeg, image/png, image/webp`. A file named `x.php` carrying a real PNG is refused on its extension, `Upload extension "php" is not allowed. Allowed extensions: jpg, jpeg, png, webp`, and so is one with no extension when an allowlist is set. A 3 MB file with a 100 byte limit gives `Upload is too large (3000000 bytes). Maximum allowed size is 100 bytes.`

Every constructor argument after the root is optional:

| Argument | Default | Meaning |
|---|---|---|
| `allowedExtensions` | `[]` | Extensions allowed in the client's name, lowercase, without the dot. Empty accepts any. |
| `allowedMimeTypes` | `[]` | Detected types allowed. Empty accepts any. |
| `maxSizeBytes` | `null` | Maximum size in bytes. `null` is no limit. |
| `fileMover` | genuine uploads only | How the file is moved (see [Test an upload](#test-an-upload)). |
| `mimeExtensionMap` | `[]` | Extra or overriding detected type to extension pairs. |
| `overwriteExisting` | `false` | Whether an existing file may be replaced. |

Set both allowlists. With none, every file is accepted, including types you never meant to receive.

### Where the file name comes from

When you do not pass a third argument to `store()`, the file is named with 32 random hex characters, and its extension comes from the detected type: a PNG gets `.png` whatever it was called. A detected type with no entry in the framework's map (a type the framework does not know) gets no extension at all. Add one with `mimeExtensionMap`:

```php
new Uploader($root, mimeExtensionMap: ['application/octet-stream' => 'bin']);
```

The map has no entry for HTML, SVG, XML, PHP or shell scripts, on purpose: such a file is stored without an extension, so a web server cannot mistake it for something to run. SVG and XML (an XHTML document, for one) can carry script, and served as static files they run it in the browser, even when the client named the upload `avatar.png`. Map one only if you need it (`mimeExtensionMap: ['image/svg+xml' => 'svg']`), and serve it with the precautions below. Version 0.14.0 mapped `image/svg+xml`, `application/xml` and `text/xml` by default.

`store($file, $subDirectory, $targetName)` accepts a name of your own. Do that only for a name your code builds, such as `avatar-7.png` from a user id. Never pass any part of the client's file name. A name you pass is checked against `allowedExtensions` and against the detected type: its last extension must be the one the map gives that type, or an alias (`jpeg` and `jpe` for `image/jpeg`, `tif` for `image/tiff`, `md` and `csv` for `text/plain`, `markdown` for `text/markdown`), so `avatar-7.png` is refused for a file detected as a PDF. A type with no entry in the map accepts a name without an extension only. A name with a slash or a leading dot (`.htaccess`) is refused, and so is one that ends with a dot or a space, contains a colon, a control or format character (a NUL byte, the right-to-left override, a zero width joiner), U+2028 or U+2029, is not valid UTF-8, or whose part before the first dot is a Windows device name in any case (`CON`, `PRN`, `AUX`, `NUL`, `COM1` to `COM9`, `LPT1` to `LPT9`, `CONIN$`, `CONOUT$`): `con.png` gives `Invalid upload target filename: "con.png".` Each segment of the sub-directory gets the same checks, a colon and a trailing dot included (`Invalid upload sub-directory segment: "a:b".`). Version 0.16 stripped a NUL byte from the name and the sub-directory; it is now refused. Some legitimate names are refused too (`nul.pdf`, a Persian name with a zero width non-joiner): another reason to let the uploader generate the name. An existing file is not replaced unless the uploader was built with `overwriteExisting: true`.

## Serve a file back

Keep the storage root outside `public/`. A file in the document root is a URL anyone can request, and a web server decides how to treat it from its extension. Serve uploads through a controller that checks who is asking:

```php
use Zephyrus\Routing\Attribute\Get;

#[Get('/avatars/{name}', constraints: ['name' => '[0-9a-f]{32}\.(?:jpg|png|webp)'])]
public function show(string $name): Response
{
    $path = dirname(__DIR__, 2) . '/storage/uploads/avatars/' . $name;
    if (!is_file($path)) {
        return $this->text('Not found', 404);
    }

    $types = ['jpg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];

    return new Response((string) file_get_contents($path), 200, [
        'Content-Type' => $types[pathinfo($name, PATHINFO_EXTENSION)],
        'X-Content-Type-Options' => 'nosniff',
        'Cache-Control' => 'private, max-age=3600',
    ]);
}
```

What makes this safe:

- **The route constraint is the filter.** Only names of the exact shape the uploader generates reach the method, so `..` and other names answer 404 before any code runs. The constraint syntax is described on [Routing](../../fundamentals/routing/).
- **The content type comes from your own table**, keyed by the extension of the generated name, never from the request or the original upload.
- **`X-Content-Type-Options: nosniff`** stops a browser from guessing a different type.
- **Add your access check** (is this visitor allowed to see this file?) before the `file_get_contents()`. See [Authentication](../../fundamentals/authentication/).

For a file a visitor should download rather than display, add `Content-Disposition: attachment`. Do that for every type that is not an image you chose: an SVG opened in the browser runs its script in your site's origin.

A request for `/avatars/<the generated name>` is answered with 200 and `Content-Type: image/png`; `/avatars/shell.png` and an encoded `..` path are answered with 404.

## Size limits

Three limits stack, and a file must pass all of them:

1. **PHP's own limits**, `upload_max_filesize` (2M by default) and `post_max_size` (8M by default). A larger file never reaches your code as a file: `FileUpload::isValid()` is false, and `store()` throws `Upload failed: File exceeds the server maximum upload size (upload_max_filesize).` A 3 MB file sent to the default PHP settings is refused that way, whatever `maxSizeBytes` says. Raise both settings above the largest file you accept.
2. **The body size middleware.** `MaxBodySizeMiddleware` answers 413 for a body larger than `security.max_body_size`. For a multipart body it measures the largest of the declared `Content-Length` and the files plus the text fields PHP parsed, so a request that declares a short length, or none, is still counted. It runs after PHP has read the body, which is why it does not replace the PHP settings. A 7 MB upload against a 6 MB limit is answered with `413 Content Too Large`. See [Security](../../fundamentals/security/#request-body-size).
3. **`maxSizeBytes`** on the uploader, checked against the real size of the file.

Set `max_body_size` a little above `maxSizeBytes` times the number of files a form can carry, since the body also holds the other fields and the multipart framing.

## Test an upload

The default mover accepts only a genuine HTTP upload (PHP's `is_uploaded_file()`), so a file you created in a test, or in a command-line script, is refused with `Refusing to move "...": it is not a genuine PHP upload. Inject a $fileMover when storing files that did not arrive over HTTP.` Inject a mover that copies:

```php
use Zephyrus\Upload\FileUpload;
use Zephyrus\Upload\Uploader;

$uploader = new Uploader(
    $root . '/storage/uploads',
    allowedExtensions: ['png'],
    allowedMimeTypes: ['image/png'],
    fileMover: fn (string $from, string $to): bool => copy($from, $to),
);

$file = new FileUpload('me.png', 'image/png', $root . '/tests/files/pixel.png', filesize($root . '/tests/files/pixel.png'));
$path = $uploader->store($file);
```

Use the mover only in tests: it removes the guarantee that the file came from the request that is being handled.

## FileUpload

`FileUpload` is an immutable value object. You get one from the request, or build one yourself as above (`originalName`, `clientMimeType`, `tmpPath`, `sizeBytes`, `errorCode`):

| Member | What it gives |
|---|---|
| `originalName`, `clientMimeType`, `sizeBytes` | What the client claimed. Display them; never decide with them. |
| `tmpPath` | Where PHP put the temporary file. |
| `errorCode` | PHP's upload error, `UPLOAD_ERR_OK` when fine. |
| `isValid()` | Whether PHP reported no error. |
| `assertValid()` | Throws `UploadException` describing the PHP error. |
| `extension()` | The last extension of the client's name, lowercase. |
| `extensions()` | Every dotted segment of the client's name: `avatar.php.png` gives `['php', 'png']`. |
| `FileUpload::fromPhpArray($entry)` | Builds one from a `$_FILES['field']` entry. |
| `FileUpload::listFromPhpArray($entry)` | Builds a list from an entry, including `photos[]` and nested fields. |

## UploadException

Every refusal is an `UploadException`: a PHP upload error, a missing or unreadable temporary file, a type, extension or size that is not allowed, a path that escapes the root, a destination that exists, a move that failed, and a file that is not a genuine upload. Catch it around `store()` and answer with a sentence of your own. Its message is for your logs.

## Good to know

- **Set both allowlists**, and the size limit. The zero-configuration `Uploader` accepts everything.
- **Never use the client's file name** for storage, in a path, or in a header. Use the path `store()` returned.
- **Keep the root out of `public/`**, and serve through a controller that checks access.
- **An unknown detected type is stored with no extension.** Add it to `mimeExtensionMap` if you accept it.
- **Check PHP's limits too.** `upload_max_filesize` and `post_max_size` refuse a large file before `maxSizeBytes` is looked at.
- **An existing name is not replaced.** `store()` throws unless `overwriteExisting` is true: `Refusing to overwrite the existing file "...". Pass $overwriteExisting to allow replacement.`
