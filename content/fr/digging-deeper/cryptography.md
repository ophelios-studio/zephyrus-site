---
title: Cryptographie
order: 3
description: Générez des jetons aléatoires, hachez et vérifiez des mots de passe avec Argon2id, chiffrez des données avec XChaCha20-Poly1305 à l’aide d’une clé tirée de l’environnement, et hachez des données avec BLAKE2b.
---

# Cryptographie

Des primitives solides, difficiles à mal utiliser.

`Zephyrus\Security\Cryptography` est un ensemble de méthodes statiques au-dessus de libsodium (l’extension `sodium` que le framework exige). Chacune fait un seul travail avec un seul algorithme, sans option susceptible de mal tourner. La plupart des erreurs dans ce domaine viennent de l’emploi du bon outil pour le mauvais travail : commencez donc par le choix.

| Vous avez besoin de | Utilisez | Pas |
| --- | --- | --- |
| Un jeton impossible à deviner : un lien de réinitialisation, une invitation, une clé d’API | `randomHex()`, `randomString()` | `uniqid()`, `mt_rand()`, `md5(time())` |
| Stocker un mot de passe et le vérifier plus tard | `hashPassword()`, `verifyPassword()` | `encrypt()`, qui peut être inversé ; `hash()`, qui est rapide à deviner |
| Stocker des données que vous devez relire | `encrypt()`, `decrypt()` | Une empreinte, qui ne peut pas être inversée |
| Une empreinte de données ou d’un fichier | `hash()`, `hashFile()` | Les mots de passe |
| Retrouver une valeur secrète sans la stocker en clair | `hash()` avec une clé | Une empreinte sans clé de données devinables |

## Jetons aléatoires

```php
use Zephyrus\Security\Cryptography;

Cryptography::randomHex(64);         // 64 hex characters (32 bytes)
Cryptography::randomString(43);      // 43 characters of A-Z, a-z, 0-9, "-" and "_"
Cryptography::randomBytes(32);       // 32 raw bytes
Cryptography::randomInt(100000, 999999); // an integer in the range, both ends included
```

Les quatre utilisent le générateur cryptographiquement sûr du système. Un jeton qui donne accès à quelque chose exige au moins 128 bits : `randomHex(32)` ou `randomString(22)`. `randomHex(64)` (256 bits) est un choix par défaut confortable. Une longueur inférieure à 1 lance `CryptographyException: Length must be at least 1.` ; `randomInt()` avec `$min` supérieur à `$max` lance le `ValueError` de PHP.

Un jeton qui déverrouille quelque chose, comme une réinitialisation de mot de passe, est un mot de passe en tout sauf le nom : mettez-le dans le lien, et ne stockez que son empreinte, afin qu’une fuite de votre base de données ne distribue pas des liens fonctionnels :

```php
$token = Cryptography::randomHex(64);    // goes in the emailed link, never stored
$tokenHash = Cryptography::hash($token); // stored with the account and an expiry
```

Quand le lien revient, calculez l’empreinte du jeton qu’il porte et cherchez cette empreinte avec une requête paramétrée. Une empreinte rapide suffit ici parce que le jeton est aléatoire : il n’y a rien à deviner. Supprimez l’empreinte stockée une fois le jeton utilisé, et à son expiration, de sorte qu’un lien ne fonctionne qu’une seule fois.

## Mots de passe

```php
$hash = Cryptography::hashPassword('correct horse battery staple');
// $argon2id$v=19$m=65536,t=2,p=1$LPtUkw+BBSatj37o+NxIww$2GWn413K3PvdbeaWm6VxAZPtghmNxe2Rk5LNzw/hd5M

Cryptography::verifyPassword('correct horse battery staple', $hash); // true
Cryptography::verifyPassword('wrong', $hash);                        // false
Cryptography::needsRehash($hash);                                    // false
```

`hashPassword()` utilise Argon2id aux limites interactives de libsodium (64 Mio de mémoire, deux passes) : lent et gourmand en mémoire à dessein, pour que chaque tentative coûte autant à un attaquant. Le sel est aléatoire et stocké dans la chaîne d’empreinte elle-même : hacher deux fois le même mot de passe donne donc deux chaînes différentes. Stockez la chaîne entière, dans une colonne `text`.

`needsRehash()` retourne `true` quand une empreinte a été produite avec d’autres paramètres, ou ne peut pas être analysée. Vérifiez-la après un `verifyPassword()` réussi, pendant que vous détenez encore le mot de passe, et stockez une nouvelle empreinte :

```php
if (Cryptography::verifyPassword($password, $account->password_hash)) {
    if (Cryptography::needsRehash($account->password_hash)) {
        $this->accounts->updatePasswordHash($account->id, Cryptography::hashPassword($password));
    }
    // ... sign the user in
}
```

La [page d’authentification](../../fundamentals/authentication/#se-connecter) montre cela dans une connexion complète.

### À savoir

- `verifyPassword()` ne lance jamais d’exception : une empreinte malformée donne simplement `false`. Elle accepte n’importe quelle empreinte Argon2id, y compris une issue de `password_hash($password, PASSWORD_ARGON2ID)` de PHP, pour laquelle `needsRehash()` vaut `true`. Elle retourne `false` pour une empreinte bcrypt (`$2y$...`) : migrez ces comptes avec `password_verify()` et stockez `hashPassword()` en cas de succès.
- Les deux méthodes acceptent un poivre (pepper) optionnel, un secret gardé en dehors de la base de données : `hashPassword($password, $pepper)` et `verifyPassword($password, $hash, $pepper)`. Il est ajouté devant le mot de passe sans séparateur : utilisez donc une valeur de longueur fixe (32 octets aléatoires) tirée de l’environnement. Le perdre ou le changer invalide toutes les empreintes stockées.
- Ne chiffrez jamais les mots de passe « pour pouvoir les relire », et ne les hachez jamais avec `hash()` : une empreinte rapide d’une valeur devinable se devine rapidement.

## Chiffrement

`encrypt()` et `decrypt()` protègent les données que vous devez relire : les identifiants d’API d’un tiers, un numéro de compte bancaire, des notes que vos utilisateurs vous confient. L’algorithme est XChaCha20-Poly1305, qui détecte aussi toute modification du texte chiffré.

### La clé

La clé fait 32 octets aléatoires, conservés dans l’environnement en base64url. Générez-en une avec :

```bash
php -r 'require "vendor/autoload.php"; echo Zephyrus\Security\Cryptography::encodeKey(Zephyrus\Security\Cryptography::generateEncryptionKey()), PHP_EOL;'
```

Elle affiche une valeur de 43 caractères comme `I4PfXwBxUckskhCc8RBEmnrDTjwc9x3hDjn073HFnoo`. Définissez-la comme `APP_ENCRYPTION_KEY` dans l’environnement du serveur (ou dans un fichier `.env` tenu hors du contrôle de version), et lisez-la par la configuration :

```yaml
security:
  encryption:
    key: !env APP_ENCRYPTION_KEY
```

`$config->security->encryptionKey` est alors la chaîne encodée, ou `null` quand la variable n’est pas définie ou est vide. Décodez-la une seule fois, en refusant de continuer sans elle :

```php
$encoded = $config->security->encryptionKey
    ?? throw new \RuntimeException('Set APP_ENCRYPTION_KEY: see the cryptography guide.');
$key = Cryptography::decodeKey($encoded); // 32 raw bytes
```

### Chiffrer et déchiffrer

```php
$sealed = Cryptography::encrypt('4111 1111 1111 1111', $key, context: 'account:42|card');
// c08uzpvgTEMDa7urg-Yfwv5YT6jkG9AQOTkaFQJDLqNYB6wNViLjTYV7x5BwVLd2uZT9bACS2FApKc8

$plain = Cryptography::decrypt($sealed, $key, context: 'account:42|card');
// 4111 1111 1111 1111
```

Le résultat est du texte en base64url, sûr pour une colonne `text` : le nonce de 24 octets, le texte chiffré et une étiquette de 16 octets, de sorte que le numéro de carte de 19 caractères ci-dessus devient 79 caractères. Un nouveau nonce aléatoire est tiré à chaque appel : chiffrer deux fois la même valeur donne donc deux résultats différents.

### Le contexte

Le `context` lie un texte chiffré à l’endroit où il appartient. Il n’est ni secret ni stocké, mais `decrypt()` doit recevoir exactement la même chaîne. Utilisez la ligne, la colonne ou le locataire où vit la valeur : si quelqu’un copie le texte chiffré du compte 42 dans la ligne du compte 43, il ne s’ouvre plus.

```text
decrypt($sealed, $key, context: 'account:43|card')
  CryptographyException: Decryption failed. The ciphertext may be corrupted or the key is incorrect.
```

Choisissez le contexte avant de stocker des données. Des données chiffrées sans contexte (la valeur par défaut est `''`) ne s’ouvrent que sans contexte : en ajouter un plus tard oblige à déchiffrer et rechiffrer chaque valeur.

### Échecs

Chaque échec est une `CryptographyException`, avec un message qui nomme le problème et jamais la clé ni les données :

| Cause | Message |
| --- | --- |
| Mauvaise clé, mauvais contexte, ou texte chiffré modifié | `Decryption failed. The ciphertext may be corrupted or the key is incorrect.` |
| Un texte chiffré tronqué ou qui n’est pas en base64url | `Invalid cryptographic payload: Ciphertext is too short or malformed.` |
| La clé encodée passée au lieu de la clé décodée | `Invalid cryptographic key: Key must be exactly 32 bytes, got 43.` |
| Une clé composée uniquement de zéros | `Invalid cryptographic key: The all-zero key is refused; it is what an unset or mis-decoded configuration value produces.` |
| Une valeur qui n’est pas en base64url, passée à `decodeKey()` | `Invalid cryptographic key: Unable to decode key (invalid base64url).` |

Interceptez-la là où vous déchiffrez, et traitez la valeur comme illisible. Comme pour toute exception, journalisez-la et montrez à l’utilisateur une page d’erreur simple, jamais le message.

### À savoir

- Gardez la clé hors du dépôt et hors de `config.yml` : seulement `!env`. Utilisez une clé différente par environnement.
- Perdre la clé, c’est perdre les données. Sauvegardez-la, séparément des sauvegardes de la base de données.
- `Cryptography` prend une seule clé par appel et ne tient aucun trousseau. Pour effectuer une rotation, déchiffrez chaque valeur avec l’ancienne clé et chiffrez-la avec la nouvelle ; si les deux doivent fonctionner pendant un temps, stockez un identifiant de clé à côté de chaque valeur.
- Un texte chiffré ne peut pas être recherché : le nonce aléatoire fait paraître différentes des valeurs égales. Pour trouver une ligne par un courriel chiffré, stockez à côté une empreinte à clé, `Cryptography::hash(mb_strtolower($email), $indexKey)`, produite avec une seconde clé, et interrogez cette colonne.
- Les paramètres de clé et de texte en clair sont marqués `#[\SensitiveParameter]`, de sorte que PHP les omet des traces de pile.

## Hachage

```php
Cryptography::hash('hello');
// 324dcf027dd4a30a932c441f365a25e86b173defa4b8e58948253471b81b72cf

Cryptography::hash('hello', length: 16);  // a 16-byte digest: 32 hex characters
Cryptography::hash('ada@example.com', $indexKey); // keyed: only holders of the key can compute it
Cryptography::hashFile($root . '/storage/invoice-2041.pdf'); // the same digest as hash() of the contents
```

L’algorithme est BLAKE2b et le résultat est en hexadécimal. `$length` est la taille du condensé en octets, de 16 à 64 (32 par défaut). Une clé, lorsqu’elle est fournie, doit faire de 16 à 64 octets ; `null` donne l’empreinte sans clé, et une chaîne vide est refusée plutôt que traitée en silence comme l’absence de clé. `hashFile()` lit le fichier par blocs de 8 Ko et fonctionne donc sur de gros fichiers ; un fichier manquant lance `Hashing failed: File not found or not readable: <path>`, un message qui contient un chemin du serveur et qui a sa place dans votre journal.

Une empreinte à clé est un code d’authentification de message : utilisez-la pour établir l’empreinte d’une valeur que seule votre application doit pouvoir reproduire, comme l’index de recherche ci-dessus. Quand vous en utilisez une comme MAC pour authentifier des données, comparez une valeur reçue avec `hash_equals()`, jamais avec `===`.

## Clés de signature

`generateSigningKeyPair()` retourne une paire de clés Ed25519, encodée en hexadécimal : `['publicKey' => ..., 'secretKey' => ...]` (64 et 128 caractères hexadécimaux). `Cryptography` n’a pas de méthode de signature ni de vérification ; utilisez les fonctions sodium avec les clés décodées :

```php
$pair = Cryptography::generateSigningKeyPair();

$signature = sodium_crypto_sign_detached($payload, sodium_hex2bin($pair['secretKey']));
$valid = sodium_crypto_sign_verify_detached($signature, $payload, sodium_hex2bin($pair['publicKey'])); // true
```

Gardez la clé secrète dans l’environnement comme la clé de chiffrement, et ne publiez que la clé publique.

## CryptographyException

`Zephyrus\Security\CryptographyException` étend `Zephyrus\Exceptions\ZephyrusRuntimeException`, et par elle `Zephyrus\Exceptions\ZephyrusException` et `Exception`. Ce n’est pas une `\RuntimeException` : interceptez-la donc par son nom. Elle est lancée par `encrypt()`, `decrypt()`, `decodeKey()`, `hashPassword()`, `hash()`, `hashFile()` et les méthodes aléatoires auxquelles on donne une longueur inférieure à 1. `verifyPassword()` et `needsRehash()` ne lancent jamais d’exception.

`Cryptography::ENCRYPTION_KEY_BYTES` contient la longueur de la clé, `32`.
