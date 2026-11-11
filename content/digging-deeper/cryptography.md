---
title: Cryptography
order: 3
description: Generate random tokens, hash and verify passwords with Argon2id, encrypt data with XChaCha20-Poly1305 using a key from the environment, and hash data with BLAKE2b.
---

# Cryptography

Sound primitives, hard to misuse.

`Zephyrus\Security\Cryptography` is a set of static methods over libsodium (the `sodium` extension the framework requires). Each one does one job with one algorithm and no options to get wrong. Most mistakes in this area come from using the right tool for the wrong job, so start with the choice.

| You need | Use | Not |
| --- | --- | --- |
| An unguessable token: a reset link, an invitation, an API key | `randomHex()`, `randomString()` | `uniqid()`, `mt_rand()`, `md5(time())` |
| To store a password and check it later | `hashPassword()`, `verifyPassword()` | `encrypt()`, which can be reversed; `hash()`, which is fast to guess |
| To store data you must read back | `encrypt()`, `decrypt()` | A hash, which cannot be reversed |
| A fingerprint of data or of a file | `hash()`, `hashFile()` | Passwords |
| To look up a secret value without storing it in clear | `hash()` with a key | An unkeyed hash of guessable data |

## Random tokens

```php
use Zephyrus\Security\Cryptography;

Cryptography::randomHex(64);         // 64 hex characters (32 bytes)
Cryptography::randomString(43);      // 43 characters of A-Z, a-z, 0-9, "-" and "_"
Cryptography::randomBytes(32);       // 32 raw bytes
Cryptography::randomInt(100000, 999999); // an integer in the range, both ends included
```

All four use the system's cryptographically secure generator. A token that grants access needs at least 128 bits: `randomHex(32)` or `randomString(22)`. `randomHex(64)` (256 bits) is a comfortable default. A length below 1 throws `CryptographyException: Length must be at least 1.`; `randomInt()` with `$min` above `$max` throws PHP's `ValueError`.

A token that unlocks something, such as a password reset, is a password in all but name: put it in the link, and store only its hash, so a leak of your database does not hand out working links:

```php
$token = Cryptography::randomHex(64);    // goes in the emailed link, never stored
$tokenHash = Cryptography::hash($token); // stored with the account and an expiry
```

When the link comes back, hash the token it carries and look the hash up with a parameterised query. A fast hash is enough here because the token is random: there is nothing to guess.

## Passwords

```php
$hash = Cryptography::hashPassword('correct horse battery staple');
// $argon2id$v=19$m=65536,t=2,p=1$LPtUkw+BBSatj37o+NxIww$2GWn413K3PvdbeaWm6VxAZPtghmNxe2Rk5LNzw/hd5M

Cryptography::verifyPassword('correct horse battery staple', $hash); // true
Cryptography::verifyPassword('wrong', $hash);                        // false
Cryptography::needsRehash($hash);                                    // false
```

`hashPassword()` uses Argon2id at libsodium's interactive limits (64 MiB of memory, two passes): slow and memory-hungry on purpose, so each guess costs an attacker the same. The salt is random and stored inside the hash string, so hashing the same password twice gives two different strings. Store the whole string, in a `text` column.

`needsRehash()` returns `true` when a hash was made with other parameters, or cannot be parsed. Check it after a successful `verifyPassword()`, while you still hold the password, and store a new hash:

```php
if (Cryptography::verifyPassword($password, $account->password_hash)) {
    if (Cryptography::needsRehash($account->password_hash)) {
        $this->accounts->updatePasswordHash($account->id, Cryptography::hashPassword($password));
    }
    // ... sign the user in
}
```

The [authentication page](../../fundamentals/authentication/#signing-in) shows this inside a complete sign-in.

### Good to know

- `verifyPassword()` never throws: a malformed hash is simply `false`. It accepts any Argon2id hash, including one from PHP's `password_hash($password, PASSWORD_ARGON2ID)`, for which `needsRehash()` is `true`. It returns `false` for a bcrypt hash (`$2y$...`): migrate those accounts with `password_verify()` and store `hashPassword()` on success.
- Both methods take an optional pepper, a secret kept outside the database: `hashPassword($password, $pepper)` and `verifyPassword($password, $hash, $pepper)`. It is prepended to the password with no separator, so use a fixed-length value (32 random bytes) from the environment. Losing or changing it invalidates every stored hash.
- Never encrypt passwords "so you can read them back", and never hash them with `hash()`: a fast hash of a guessable value is guessed fast.

## Encryption

`encrypt()` and `decrypt()` protect data you must read back: a third party's API credentials, a bank account number, notes your users trust you with. The algorithm is XChaCha20-Poly1305, which also detects any change to the ciphertext.

### The key

The key is 32 random bytes, kept in the environment as base64url. Generate one with:

```bash
php -r 'require "vendor/autoload.php"; echo Zephyrus\Security\Cryptography::encodeKey(Zephyrus\Security\Cryptography::generateEncryptionKey()), PHP_EOL;'
```

It prints a 43-character value such as `I4PfXwBxUckskhCc8RBEmnrDTjwc9x3hDjn073HFnoo`. Set it as `APP_ENCRYPTION_KEY` in the server's environment (or in a `.env` file kept out of version control), and read it through the configuration:

```yaml
security:
  encryption:
    key: !env APP_ENCRYPTION_KEY
```

`$config->security->encryptionKey` is then the encoded string, or `null` when the variable is unset or empty. Decode it once, refusing to continue without it:

```php
$encoded = $config->security->encryptionKey
    ?? throw new \RuntimeException('Set APP_ENCRYPTION_KEY: see the cryptography guide.');
$key = Cryptography::decodeKey($encoded); // 32 raw bytes
```

### Encrypting and decrypting

```php
$sealed = Cryptography::encrypt('4111 1111 1111 1111', $key, context: 'account:42|card');
// c08uzpvgTEMDa7urg-Yfwv5YT6jkG9AQOTkaFQJDLqNYB6wNViLjTYV7x5BwVLd2uZT9bACS2FApKc8

$plain = Cryptography::decrypt($sealed, $key, context: 'account:42|card');
// 4111 1111 1111 1111
```

The result is base64url text, safe for a `text` column: the 24-byte nonce, the ciphertext and a 16-byte tag, so the 19-character card number above becomes 79 characters. A fresh random nonce is drawn for every call, so encrypting the same value twice gives two different results.

### The context

The `context` binds a ciphertext to where it belongs. It is not secret and not stored, but `decrypt()` must receive exactly the same string. Use the row, column or tenant the value lives in: if someone copies the ciphertext of account 42 into account 43's row, it no longer opens.

```text
decrypt($sealed, $key, context: 'account:43|card')
  CryptographyException: Decryption failed. The ciphertext may be corrupted or the key is incorrect.
```

Choose the context before you store data. Data encrypted without one (the default is `''`) only opens without one: adding a context later means decrypting and re-encrypting every value.

### Failures

Every failure is a `CryptographyException`, with a message that names the problem and never the key or the data:

| Cause | Message |
| --- | --- |
| Wrong key, wrong context, or a modified ciphertext | `Decryption failed. The ciphertext may be corrupted or the key is incorrect.` |
| A truncated or non-base64url ciphertext | `Invalid cryptographic payload: Ciphertext is too short or malformed.` |
| The encoded key passed instead of the decoded one | `Invalid cryptographic key: Key must be exactly 32 bytes, got 43.` |
| An all-zero key | `Invalid cryptographic key: The all-zero key is refused; it is what an unset or mis-decoded configuration value produces.` |
| A value that is not base64url, to `decodeKey()` | `Invalid cryptographic key: Unable to decode key (invalid base64url).` |

Catch it where you decrypt, and treat the value as unreadable. As with any exception, log it and show the user a plain error page, never the message.

### Good to know

- Keep the key out of the repository and out of `config.yml`: only `!env`. Use a different key per environment.
- Losing the key loses the data. Back it up, separately from the database backups.
- `Cryptography` takes one key per call and keeps no key ring. To rotate, decrypt each value with the old key and encrypt it with the new one; if both must work for a while, store a key identifier next to each value.
- A ciphertext cannot be searched: the random nonce makes equal values look different. To find a row by an encrypted email, store a keyed hash next to it, `Cryptography::hash(mb_strtolower($email), $indexKey)`, made with a second key, and query that column.
- The key and plaintext parameters are marked `#[\SensitiveParameter]`, so PHP leaves them out of stack traces.

## Hashing

```php
Cryptography::hash('hello');
// 324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf

Cryptography::hash('hello', length: 16);  // a 16-byte digest: 32 hex characters
Cryptography::hash('ada@example.com', $indexKey); // keyed: only holders of the key can compute it
Cryptography::hashFile($root . '/storage/invoice-2041.pdf'); // the same digest as hash() of the contents
```

The algorithm is BLAKE2b and the result is hex. `$length` is the digest size in bytes, from 16 to 64 (32 by default). A key, when given, must be 16 to 64 bytes; `null` is the unkeyed hash, and an empty string is refused rather than silently treated as no key. `hashFile()` reads the file in 8 KB chunks, so it works on large files; a missing file throws `Hashing failed: File not found or not readable: <path>`, a message that holds a server path and belongs in your log.

A keyed hash is a message authentication code: use it to fingerprint a value that only your application should be able to reproduce, such as the search index above.

## Signing keys

`generateSigningKeyPair()` returns an Ed25519 key pair, hex encoded: `['publicKey' => ..., 'secretKey' => ...]` (64 and 128 hex characters). `Cryptography` has no sign or verify method; use the sodium functions with the decoded keys:

```php
$pair = Cryptography::generateSigningKeyPair();

$signature = sodium_crypto_sign_detached($payload, sodium_hex2bin($pair['secretKey']));
$valid = sodium_crypto_sign_verify_detached($signature, $payload, sodium_hex2bin($pair['publicKey'])); // true
```

Keep the secret key in the environment like the encryption key, and publish only the public one.

## CryptographyException

`Zephyrus\Security\CryptographyException` extends `Zephyrus\Exceptions\ZephyrusRuntimeException`, and through it `Zephyrus\Exceptions\ZephyrusException` and `Exception`. It is not a `\RuntimeException`, so catch it by name. It is thrown by `encrypt()`, `decrypt()`, `decodeKey()`, `hashPassword()`, `hash()`, `hashFile()` and the random methods given a length below 1. `verifyPassword()` and `needsRehash()` never throw.

`Cryptography::ENCRYPTION_KEY_BYTES` holds the key length, `32`.
