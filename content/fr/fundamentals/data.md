---
title: Accès aux données
order: 12
description: Connectez-vous à PostgreSQL, exécutez requêtes paramétrées et transactions, hydratez des entités et bâtissez des listes paginées, triées et filtrées depuis la requête.
---

# Accès aux données

Votre SQL. Votre modèle de données.

Zephyrus communique avec PostgreSQL par l’entremise de `Zephyrus\Data\Database`, une mince couche au-dessus de PDO. Vous écrivez le SQL, le framework lie les paramètres, convertit les types de colonnes et signale les échecs. Il n’y a ni générateur de requêtes ni ORM : une requête est une chaîne de caractères que vous pouvez lire.

## Connexion

Ajoutez une section `database:` à `config.yml`. Les secrets proviennent de l’environnement avec `!env`, jamais du fichier :

```yaml
database:
  host: !env DB_HOST, localhost
  port: !env DB_PORT, 5432
  database: !env DB_NAME, app
  username: !env DB_USERNAME, app
  password: !env DB_PASSWORD
```

`database` et `username` sont obligatoires. Les autres clés sont `driver` (seulement `pgsql`), `charset` (`utf8` par défaut), `ssl_mode` (`disable`, `allow`, `prefer`, `require`, `verify-ca` ou `verify-full`), `ssl_root_cert`, `column_cache_version` et `persistent` (voir [connexions persistantes](#connexions-persistantes)). Toute autre clé interrompt le démarrage en proposant l’orthographe acceptée la plus proche. La section est interprétée en un `DatabaseConfig`, accessible par `$config->database` (`null` lorsque la section est absente).

```php
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Data\Database;

$config = Configuration::fromYamlFile($root . '/config.yml');
$db = Database::fromConfig($config->database);
```

`fromConfig()` ouvre la connexion avec `PDO::connect()`, si bien que `$db->pdo()` est un `Pdo\Pgsql`, et avec des requêtes préparées côté serveur : le SQL et les valeurs voyagent toujours séparément, et il est impossible de désactiver ce comportement. Sous PostgreSQL, chaque requête part aussi en instruction non nommée (`Pdo\Pgsql::ATTR_DISABLE_PREPARES`, posé après la connexion) : un aller-retour au lieu de trois (préparer, exécuter, fermer), les paramètres restant liés côté serveur et jamais émulés. La version 0.14.1 préparait une instruction nommée par requête. Pour retrouver les instructions nommées, appelez `$db->pdo()->setAttribute(\Pdo\Pgsql::ATTR_DISABLE_PREPARES, false)`. Une connexion qui échoue lève une `DatabaseException` qui nomme le DSN (hôte, port, base de données, jamais le mot de passe) et la raison fournie par le pilote : journalisez-la, ne l’affichez pas.

`Database` n’est pas créée pour vous. Construisez-la une seule fois et transmettez-la à vos brokers, ou enregistrez-la dans le [conteneur](../../digging-deeper/container-and-events/) pour que les contrôleurs et les brokers la reçoivent par leur constructeur :

```php
use Zephyrus\Container\Container;

$container = new Container();
$container->singleton(Database::class, static fn (): Database => Database::fromConfig($config->database));

$builder = $builder->withContainer($container);
```

### Connexions persistantes

`persistent: true` garde une connexion par processus PHP et la remet au prochain `fromConfig()` de ce processus, ce qui épargne le coût d’une nouvelle connexion à chaque requête. La valeur par défaut est `false`, et `!env` fonctionne (`persistent: !env DB_PERSISTENT, false`).

Chaque fois que `fromConfig()` reprend la connexion, il envoie `ROLLBACK` si une transaction est restée ouverte, puis `DISCARD ALL`, et écarte les notifications déjà reçues : les paramètres, `SET ROLE`, les verrous consultatifs de session, les tables temporaires et les instructions préparées n’atteignent jamais la requête suivante. Une trace subsiste : un paramètre personnalisé posé par le détenteur précédent se lit `''` au lieu de `NULL`, d’où la lecture `nullif(current_setting('app.actor_id', true), '')` dans une politique. Une connexion dont la remise à zéro échoue est fermée et remplacée une fois ; un second échec lève une `DatabaseException`.

- Tant qu’une `Database` construite sur la connexion persistante est en vie, un autre `fromConfig()` avec les mêmes réglages ouvre une connexion ordinaire, pour qu’une session ne soit jamais remise à zéro sous son détenteur. Partagez une seule `Database` par requête.
- Chaque processus garde sa connexion toute sa vie : le `max_connections` de PostgreSQL doit couvrir chaque processus PHP-FPM ou Apache de chaque serveur, plus vos scripts en ligne de commande.
- Une fabrique de connexion ne pose aucun état de session : avec `persistent: true`, elle s’exécute avant la remise à zéro, qui l’efface. Posez l’état de session après le retour de `fromConfig()`.
- Sous PHP 8.5, une fabrique à vous utilisée avec `persistent: true` construit la connexion avec `PDO::connect()`, comme celle par défaut, sinon chaque réutilisation émet une dépréciation.

La persistance passe par cette clé seulement. `new Database($pdo)` refuse un PDO ouvert avec `PDO::ATTR_PERSISTENT`, et `fromConfig()` refuse une fabrique de connexion qui en renvoie un alors que `persistent` vaut `false`, car la session d’une telle connexion passerait telle quelle d’une requête précédente à la suivante :

```text
Zephyrus\Data\DatabaseException: Database refuses a persistent PDO, whose session would carry over from an earlier request: remove PDO::ATTR_PERSISTENT from the PDO and set database.persistent: true in the configuration, so Database::fromConfig() resets the session each time it reuses the connection.
```

## Exécuter des requêtes

Les exemples de cette page utilisent les tables suivantes :

```sql
CREATE TABLE project (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'active',
    budget numeric(20, 2) NOT NULL DEFAULT 0,
    tags text[] NOT NULL DEFAULT '{}',
    meta jsonb,
    archived boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    total numeric(12, 2) NOT NULL
);

CREATE TABLE order_line (
    order_id bigint NOT NULL REFERENCES orders (id),
    sku text NOT NULL
);

CREATE TABLE blob (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    digest bytea NOT NULL
);
```

Les marqueurs de paramètres sont positionnels (`?`) ou nommés (`:name`), jamais mélangés dans une même instruction. Les valeurs sont toujours liées, jamais concaténées :

```php
$project = $db->selectOne('SELECT id, name FROM project WHERE id = ?', [$id]);
$rows = $db->select('SELECT id, name FROM project WHERE status = :status', ['status' => 'active']);
```

Les lignes sont des objets `stdClass`. Ces méthodes lisent :

| Méthode | Retourne |
|---|---|
| `select($sql, $params)` | toutes les lignes, sous forme de liste |
| `selectOne(...)` | la première ligne, ou `null` |
| `selectValue(..., $default)` | la première colonne de la première ligne, ou `$default` |
| `selectInt`, `selectString`, `selectBool`, `selectFloat` | la même valeur convertie en un type, ou la valeur par défaut (`0`, `null`, `false`, `0.0`) |
| `count($sql, $params)` | un `int` issu d’un `SELECT count(*)` |
| `exists($sql, $params)` | `true` lorsque la première colonne est évaluée comme vraie |

Celles-ci écrivent et retournent le nombre de lignes touchées :

| Méthode | Usage |
|---|---|
| `execute`, `insert`, `update`, `delete` | le même appel sous quatre noms, pour la lisibilité |
| `insertGetId($sql, $params)` | un `INSERT ... RETURNING id`, qui retourne l’identifiant sous forme de chaîne (ou `false` si aucune ligne n’est revenue) |

```php
$id = (int) $db->insertGetId(
    'INSERT INTO project (name, budget) VALUES (?, ?) RETURNING id',
    ['Alpha', '1200.00'],
);
$db->update('UPDATE project SET archived = ? WHERE id = ?', [true, $id]);
```

Avec PostgreSQL, l’identifiant revient uniquement par `RETURNING`. `insertGetId()` refuse une instruction qui en est dépourvue, et `lastInsertId()` est refusée, car elle peut désigner la séquence d’une autre table.

Les paramètres sont liés selon leur type : `null`, entiers, nombres à virgule flottante, chaînes, booléens, `DateTimeInterface`, `BackedEnum` (sa valeur de support), `Stringable`, `Binary` et flux. Un tableau n’a pas de forme SQL et lève une `InvalidArgumentException` : voyez [Types PostgreSQL](#types-postgresql) pour les listes. Chaque appel exécute une seule instruction : `"INSERT ...; INSERT ..."` échoue et n’insère rien.

`query()` retourne le `PDOStatement` brut et `pdo()` la connexion, pour les rares cas que les aides ne couvrent pas. Une instruction exécutée par `pdo()` n’est pas suivie par `transaction()`.

`new Database($pdo)` enveloppe une connexion PDO que vous avez ouverte vous-même (une base de données de test, par exemple) : elle y force les exceptions, les lignes sous forme d’objets et les requêtes préparées côté serveur, et laisse les instructions nommées telles quelles. `inTransaction()` indique si une transaction est ouverte à l’instant même : ne mettez pas la réponse en cache.

### Cache des types de colonnes

Les lignes sont décodées d’après les types de colonnes que rapporte PostgreSQL. Ces types sont mis en cache par texte SQL et par largeur de résultat, dans le processus et dans APCu lorsqu’il est installé. Seule une instruction dont le premier élément, après les blancs et les commentaires, est une parenthèse ou `SELECT`, `WITH`, `VALUES`, `TABLE`, `INSERT`, `UPDATE`, `DELETE` ou `MERGE` utilise le cache (un commentaire de bloc qui en contient un autre n’est pas sauté). Toute autre instruction (`FETCH`, `EXECUTE`, `SHOW`, `CALL`) décrit ses colonnes à chaque appel, soit un à deux allers-retours par colonne : récupérez donc par grands lots. La version 0.14.1 laissait un `FETCH` sur un second curseur de même largeur hériter des convertisseurs du premier, et ses colonnes `jsonb` revenaient sous forme de chaînes.

Une colonne qui change de type en gardant son nom et la largeur du résultat garde son ancien convertisseur : une colonne `jsonb` revient alors sous forme de chaîne. Réglez `column_cache_version`, dans la section `database`, sur une valeur qui change à chaque migration, et la forme périmée est abandonnée :

```yaml
database:
  column_cache_version: !env DB_SCHEMA_VERSION
```

Changez la valeur après l’exécution de la migration et avant que la nouvelle version serve du trafic. Sans elle, une forme périmée vit jusqu’à une heure sous PHP-FPM avec APCu, seulement la requête en cours sous PHP-FPM sans APCu, et jusqu’au redémarrage du processus ou à l’appel de `Database::flushSharedColumnMetadata()` dans un processus de longue durée (ligne de commande, RoadRunner).

## Transactions

`transaction()` exécute une fonction de rappel, confirme lorsqu’elle retourne et annule lorsqu’elle lève une exception. La fonction reçoit la `Database`, et sa valeur de retour est retournée :

```php
$orderId = $db->transaction(function (Database $db): int {
    $id = (int) $db->insertGetId('INSERT INTO orders (total) VALUES (?) RETURNING id', ['40.00']);
    $db->insert('INSERT INTO order_line (order_id, sku) VALUES (?, ?)', [$id, 'A-100']);

    return $id;
});
```

Appelée à l’intérieur d’une transaction ouverte, `transaction()` ouvre un point de sauvegarde : un échec n’annule que les écritures internes, et une exception interceptée à l’extérieur de l’appel interne laisse le travail externe intact.

N’interceptez pas une instruction en échec à l’intérieur de la fonction pour poursuivre ensuite. PostgreSQL interrompt la transaction à la première erreur, de sorte que la confirmation deviendrait silencieusement une annulation. Le framework le détecte et lève une `DatabaseException` (SQLSTATE `25P02`) plutôt que de signaler un succès. Laissez l’exception se propager, ou interceptez-la autour d’un `transaction()` imbriqué.

## Sécurité au niveau des lignes

La sécurité au niveau des lignes (row level security) de PostgreSQL filtre les lignes dans la base, selon des politiques qui lisent dans un paramètre l’identité de celui qui agit. `Zephyrus\Data\DatabaseActor` publie cet acteur pour une seule transaction (`set_config(..., true)`) : il n’atteint jamais la requête suivante, le prochain détenteur d’une [connexion persistante](#connexions-persistantes), ni un autre client derrière un regroupeur de connexions en mode transaction.

Une politique lit le paramètre avec `nullif(..., '')`, car un paramètre non posé peut se lire comme une chaîne vide :

```sql
ALTER TABLE project ADD COLUMN owner_id bigint;
ALTER TABLE project ENABLE ROW LEVEL SECURITY;
CREATE POLICY project_owner ON project
    USING (owner_id = nullif(current_setting('app.actor_id', true), '')::bigint);
```

**Publier ne protège rien à soi seul.** Un superutilisateur, un rôle doté de `BYPASSRLS` et le propriétaire d’une table sans `ALTER TABLE ... FORCE ROW LEVEL SECURITY` voient toutes les lignes, quel que soit l’acteur. Connectez-vous avec un rôle auquel les politiques s’appliquent.

Le constructeur reçoit la `Database`, un préfixe et les clés que lisent vos politiques : `['actor_id']` sous `app` déclare le paramètre `app.actor_id`. `actAs()` ouvre une transaction, publie les valeurs, exécute la fonction (qui reçoit la `Database`) et confirme ; l’acteur prend fin avec la transaction :

```php
use Zephyrus\Data\Database;
use Zephyrus\Data\DatabaseActor;

$actor = new DatabaseActor($db, 'app', ['actor_id']);

$projects = $actor->actAs(['actor_id' => (string) $userId], function (Database $db): array {
    return $db->select('SELECT id, name FROM project ORDER BY id');
});
```

Avec des projets appartenant aux utilisateurs 7 et 8, l’appel pour l’utilisateur 7 ne renvoie que son projet, et le même `SELECT` exécuté après `actAs()` ne renvoie aucune ligne. Dans un middleware, `return $actor->actAs([...], fn (): Response => $next($request));` exécute le reste de la requête dans cette seule transaction.

Dans une transaction que vous avez déjà ouverte, `publish()` pose l’acteur jusqu’à la fin de la transaction la plus externe (un point de sauvegarde annulé le retire) :

```php
$db->transaction(function (Database $db) use ($actor, $userId, $id): void {
    $actor->publish(['actor_id' => (string) $userId]);
    $db->update('UPDATE project SET name = ? WHERE id = ?', ['Alpha 2', $id]);
});
```

Les valeurs sont des chaînes non vides, pour les clés déclarées seulement. Chaque refus est une `DatabaseActorException`, dont le message ne contient jamais de valeur :

| Appel | Refus |
|---|---|
| `actAs(['actor_id' => 7], ...)` | `The actor value for "actor_id" must be a string, int given: cast it first, such as (string) $userId.` |
| `actAs(['actor_id' => ''], ...)` | `The actor value for "actor_id" must be a non-empty string, an empty string given: an empty value reads as no actor, so leave the key out instead.` |
| `actAs(['org_id' => '3'], ...)` | `The actor values key "org_id" names no declared key (declared: "actor_id").` |
| `actAs()` dans `transaction()` | `DatabaseActor::actAs() opens its own transaction and refuses one already open, where the actor would outlive the callback until that transaction ends: call actAs() outside any transaction, or publish() inside the open one.` |
| `publish()` hors transaction | `DatabaseActor::publish() needs an open transaction: outside one, PostgreSQL drops the actor before the next statement. Use actAs(), or call publish() inside Database::transaction().` |
| un second acteur dans la même transaction | `An actor is already published on this connection ("app.actor_id" is set): an actor changes only by ending its transaction, and a value set for the whole session is refused.` |

Le constructeur refuse une connexion autre que PostgreSQL, ainsi qu’un préfixe ou une clé qui ne compte pas de 1 à 63 lettres minuscules, chiffres et soulignés sans commencer par un chiffre (`The actor key "Actor-Id" is not a valid setting name: use 1 to 63 lowercase letters, digits and underscores, not starting with a digit.`).

- **Sans acteur**, un `SELECT` soumis à ces politiques ne renvoie aucune ligne et un `INSERT` est refusé, mais un `UPDATE` ou un `DELETE` touche 0 ligne sans erreur : vérifiez le nombre qu’il renvoie.
- **L’acteur ne change qu’à la fin de sa transaction.** Une valeur posée pour toute la session avec `set_config(..., false)` est refusée de la même façon, sur n’importe quelle clé déclarée. Deux identités dans un même traitement sont deux clés d’un même acteur, publiées ensemble.
- **Déclarez dans une seule instance toutes les clés que lisent vos politiques.** Le refus d’un second acteur couvre les clés que déclare cette instance : deux instances aux clés différentes sur la même `Database` peuvent chacune en publier un, et les acteurs s’empilent.
- **Dans `actAs()`, chaque `transaction()` est un point de sauvegarde** et la confirmation a lieu au retour d’`actAs()`. Envoyez un courriel, ou tout autre effet qui doit suivre la confirmation, une fois qu’`actAs()` est revenu.
- **Choisissez un préfixe à vous**, comme `app`, jamais `plpgsql`.

## Types PostgreSQL

Les lignes reviennent converties : entiers, nombres à virgule flottante et booléens en scalaires PHP, tableaux PostgreSQL en tableaux PHP, `json` et `jsonb` décodés (les objets en `stdClass`), horodatages et dates en chaînes.

**Tableaux.** La lecture est automatique. L’écriture exige un littéral de tableau PostgreSQL accompagné d’une conversion de type, ce qui garde la valeur comme un seul paramètre lié :

```php
$db->insert('INSERT INTO project (name, tags) VALUES (?, ?::text[])', ['Gamma', '{"php","sql"}']);
$rows = $db->select('SELECT id, name FROM project WHERE id = ANY(?::bigint[])', ['{1,2,3}']);
$row = $db->selectOne('SELECT tags FROM project WHERE name = ?', ['Gamma']);
// $row->tags === ['php', 'sql']
```

Construisez le littéral vous-même en mettant chaque élément entre guillemets doubles et en échappant `"` et `\` (une petite aide privée dans le broker suffit).

**JSON.** Liez la sortie de `json_encode()` avec une conversion de type, puis relisez-la décodée :

```php
$db->execute('UPDATE project SET meta = ?::jsonb WHERE id = ?', [json_encode(['owner' => 'ada']), $id]);
// selectOne('SELECT meta ...')->meta->owner === 'ada'
```

**Données binaires.** Enveloppez les octets dans `Binary` pour écrire dans une colonne `bytea`. Une colonne `bytea` est relue sous forme de flux, non de chaîne :

```php
use Zephyrus\Data\Binary;

$id = $db->insertGetId('INSERT INTO blob (digest) VALUES (?) RETURNING id', [new Binary(hash('sha256', 'hello', true))]);
$bytes = stream_get_contents($db->selectOne('SELECT digest FROM blob WHERE id = ?', [$id])->digest);
```

**Nombres exacts.** Les colonnes `NUMERIC` et `DECIMAL` deviennent des nombres à virgule flottante PHP, ce qui fait perdre des chiffres sur les montants élevés. Pour l’argent, enregistrez une conversion transparente afin que la valeur reste la chaîne exacte envoyée par PostgreSQL :

```php
$db->registerTypeConversion('NUMERIC', static fn (string $value): string => $value);
// 12345678901234567.89 stays '12345678901234567.89'
```

Enregistrez-la immédiatement après avoir créé la `Database`. Les convertisseurs sont indexés par le nom du type PostgreSQL et reçoivent la chaîne brute.

## Brokers, services et entités

Les applications bâties sur Zephyrus répartissent habituellement le code de données en trois parties, typiquement sous `app/Models/<Domain>/{Brokers,Services,Entities}`. Seules `Broker` et `Entity` sont des classes du framework ; la répartition elle-même est une convention.

Un **broker** contient le SQL d’un domaine. Il étend `Zephyrus\Data\Broker`, reçoit la `Database` et expose les méthodes de requête sous forme d’aides protégées (`select`, `selectOne`, `selectValue`, `selectInt`, `selectString`, `selectBool`, `selectFloat`, `selectCount`, `exists`, `selectPage`, les autres méthodes de pagination, `execute`, `transaction`). `selectString()`, `selectBool()` et `selectFloat()` lisent la première colonne de la première ligne sous la forme d’un `?string`, d’un `bool` ou d’un `float` (avec une valeur par défaut), et `selectPage($sql, $page, $perPage, $params)` retourne une page de lignes sous forme de liste. `execute()` exécute n’importe quelle instruction et retourne le nombre de lignes touchées. `lastInsertId()` est aussi présente, et refusée avec PostgreSQL comme son équivalent de `Database`. Les écritures se nomment `insertRow`, `insertRowGetId`, `updateRows` et `deleteRows`, afin de ne pas entrer en collision avec les noms de vos propres méthodes :

```php
namespace App\Models\Project\Brokers;

use Zephyrus\Data\Broker;

final class ProjectBroker extends Broker
{
    public function findById(int $id): ?\stdClass
    {
        return $this->selectOne(
            'SELECT id, name, status, budget, tags, meta FROM project WHERE id = ?',
            [$id],
        );
    }

    public function insert(string $name, string $budget): int
    {
        return (int) $this->insertRowGetId(
            'INSERT INTO project (name, budget) VALUES (?, ?) RETURNING id',
            [$name, $budget],
        );
    }
}
```

Une **entité** est un objet typé hydraté à partir d’une ligne. Les propriétés sont publiques et portent le nom des colonnes :

```php
namespace App\Models\Project\Entities;

use Zephyrus\Data\Entity;
use Zephyrus\Data\JsonIgnore;

enum Status: string
{
    case Active = 'active';
    case Archived = 'archived';
}

final class Project extends Entity
{
    public int $id;
    public string $name;
    public Status $status;
    public string $budget;
    /** @var list<string> */
    public array $tags;
    public ?\stdClass $meta = null;
    #[JsonIgnore]
    public string $internalNote = '';
}
```

Un **service** est une classe ordinaire qui appelle le broker et hydrate les entités. `Project::build($row)` retourne `null` pour une ligne `null` ; `Project::buildArray($rows)` hydrate une liste :

```php
final class ProjectService
{
    public function __construct(private readonly ProjectBroker $projects)
    {
    }

    public function find(int $id): ?Project
    {
        return Project::build($this->projects->findById($id));
    }
}
```

### Règles d’hydratation

- Chaque colonne est convertie vers le type déclaré de la propriété du même nom. Une colonne sans propriété publique correspondante est ignorée ; `getRawData()` retourne la ligne d’origine complète.
- Une colonne nommée en `snake_case` a besoin d’un alias (`created_at AS "createdAt"`) pour atteindre une propriété en `camelCase`.
- Une propriété de type énumération à valeur de support passe par `Enum::from()`. Une valeur hors de l’énumération lève une `InvalidArgumentException` qui nomme la propriété, non la valeur.
- Une propriété `stdClass` conserve l’objet JSON décodé. Une propriété typée par une autre `Entity` est construite à partir d’une colonne contenant un objet JSON.
- Un `null` est affecté tel quel : déclarez chaque colonne nullable en `?type`, faute de quoi l’hydratation lève une `TypeError`. Un type union ou intersection qui n’accepte pas `null` la lève aussi (avant 3.17, la colonne était ignorée) : utilisez un type simple comme `?string`, et non une union nullable, car une union ne reçoit jamais de valeur non nulle (voir le point suivant).
- Une propriété de date typée `DateTimeImmutable`, `DateTimeInterface` ou `DateTime` accepte une chaîne ISO (`YYYY-MM-DD`, avec heure, fraction et décalage UTC facultatifs) et est hydratée comme un `DateTimeImmutable` (un `DateTime` pour une propriété `DateTime`). Une chaîne qui ne convient pas lève une `InvalidArgumentException` (`Invalid value for date DateTimeImmutable on property $createdAt`). La version 0.14.1 laissait la propriété non initialisée.
- Une valeur qui ne peut pas être hydratée est refusée, là où la 0.14.1 l’ignorait ou échouait avec une erreur : une propriété typée par une autre classe, par un type union ou intersection, ou par une énumération pure lève une `InvalidArgumentException` (`Cannot hydrate property $status of App\Models\Order: type string|int is not supported`), tout comme une entité imbriquée qui reçoit autre chose qu’un objet JSON (`Invalid value for entity App\Models\Customer on property $customer`). Donnez à la propriété un type pris en charge, ou lisez la colonne comme chaîne et convertissez-la dans le service.
- Les propriétés privées et statiques, ainsi qu’une colonne nommée `rawData`, sont ignorées.

Une propriété que l’entité ne peut pas écrire est refusée par une `InvalidArgumentException`, là où PHP levait une `Error` brute. Une propriété readonly laissée non initialisée et une propriété `protected(set)` sont hydratées, et `json_encode()` omet une propriété virtuelle sans crochet `get`.

| Propriété | Refus |
|---|---|
| `public readonly int $id`, posée par le constructeur | `Cannot hydrate property $id of App\Models\Project: it is readonly and its constructor already set it. Leave it unset in the constructor, or drop readonly.` |
| `public private(set) string $name` | `Cannot hydrate property $name of App\Models\Project: its private(set) visibility keeps Entity from writing it. Use protected(set) instead.` |
| `public string $label { get => ... }`, virtuelle sans crochet `set` | `Cannot hydrate property $label of App\Models\Project: it is virtual with no set hook. Alias the column in the query, or give the property a set hook.` |

### Sérialisation des entités

`json_encode($entity)` émet les propriétés publiques non statiques qui ont été affectées et omet celles marquées `#[JsonIgnore]` (empreintes de mots de passe, identifiants internes). Seules les entités respectent l’attribut : une ligne `stdClass`, ou les éléments d’un `PaginatedResult`, sérialisent chaque colonne sélectionnée. Sélectionnez des colonnes explicites, ou hydratez avant de sérialiser.

## Erreurs

Chaque échec de la couche de données est une `DatabaseException`. Son message contient le SQLSTATE et rien d’autre, ce qui permet de le journaliser sans divulguer de valeurs :

```php
use Zephyrus\Data\DatabaseException;

try {
    $db->insert('INSERT INTO project (name) VALUES (?)', ['Gamma']);
} catch (DatabaseException $e) {
    $e->getMessage();   // "Query failed [SQLSTATE 23505]: statement and driver detail withheld, read sql() and driverMessage() to inspect them"
    $e->sqlState();     // "23505"
    $e->sql();          // "INSERT INTO project (name) VALUES (?)"
    $e->driverMessage(); // "SQLSTATE[23505]: Unique violation: 7 ERROR:  duplicate key value violates unique constraint ..."
}
```

Aiguillez selon `sqlState()` (par exemple `23505` pour une violation d’unicité, `23503` pour une clé étrangère). Journalisez `driverMessage()` et `sql()`, mais ne les montrez jamais à un visiteur : le texte du pilote peut contenir des valeurs de colonnes.

## Listes issues des paramètres de la requête

Quatre petites classes transforment une chaîne de requête en une liste sûre. Toutes prennent le tableau issu de `$request->query`.

```php
use Zephyrus\Data\FilterRequest;
use Zephyrus\Data\PaginationRequest;
use Zephyrus\Data\SortRequest;

// GET /projects?page=1&per_page=500&sort=-name&status=active
$page = PaginationRequest::fromQuery($request->query, defaultPerPage: 25, maxPerPage: 100);
$sort = SortRequest::fromQuery($request->query, ['name', 'created_at'], defaultColumn: 'name');
$filter = FilterRequest::fromQuery($request->query, ['status']);

$result = $db->paginateFilteredSortedResultWith(
    'SELECT id, name, status FROM project',   // no WHERE, no ORDER BY
    'SELECT count(*) FROM project',
    $filter,
    ['status' => 'status'],                   // query key => column
    $sort,
    $page,
);
```

- `PaginationRequest::fromQuery()` lit `page` (ou `offset`) et `per_page` (aussi `perPage`, `page_size`, `pageSize`, `limit`). La taille de page est bornée entre 1 et `maxPerPage`, de sorte que `per_page=500` ne peut pas réclamer 500 lignes, et la page est bornée pour que le décalage ne puisse pas déborder : une page au-delà de la dernière retourne une liste vide, elle n’échoue pas. `fromArrayWithBounds()` est le même appel. `fromArray()` n’applique aucun plafond sans son argument `maxPerPage` : utilisez-la pour des valeurs déjà validées, jamais pour une requête brute.
- `SortRequest::fromQuery()` exige une liste d’autorisation de colonnes. Une colonne qui n’en fait pas partie, y compris toute tentative d’injection, retombe sur la colonne par défaut. Elle lit `sort` (`name` en ordre croissant, `-name` en ordre décroissant), `sort_by` ou `orderBy`, ainsi que `sort_dir` ou `direction`. `fromArray()` est destinée aux entrées validées et accepte toute colonne ayant la forme d’un identifiant, sauf si vous passez `allowedColumns`.
- `$sort->toSql()` commence déjà par ` ORDER BY` et met l’identifiant entre guillemets : n’écrivez jamais `ORDER BY` avant.
- `FilterRequest::fromQuery()` ne conserve que les clés permises et construit des conditions d’égalité exacte : `status=active` devient `"status" = :f_status`, une clé répétée (`status[]=a&status[]=b`) devient une liste `IN`, et un troisième argument énumère les clés lues comme des valeurs séparées par des virgules. Les valeurs sont des paramètres liés. Les clés absentes de la correspondance de colonnes que vous passez à la méthode de requête sont ignorées.

Le résultat est un `PaginatedResult` :

```php
$result->items;        // list<stdClass>
$result->total;        // 20, rows matching the filter
$result->page;         // 1
$result->perPage;      // 100 (500 was clamped)
$result->totalPages;
$result->hasPrevious;
$result->hasNext;
```

Il offre aussi `isEmpty()`, `itemCount()`, `firstItem()`, `lastItem()`, `isFirstPage()`, `isLastPage()`, `nextPageNumber()`, `previousPageNumber()`, `toPaginationRequest()`, et `mapItems($callable)` pour transformer chaque ligne en entité ou en modèle de vue. `toArray()` et `json_encode()` donnent `items`, `total`, `page`, `per_page`, `total_pages`, `has_previous` et `has_next`, prêts pour une réponse JSON :

```php
return $this->json($result->toArray());
```

Les pièces plus petites se trouvent à la fois sur `Database` et sur `Broker` : `selectPageWith()`, `selectSorted()`, `selectFiltered()`, `selectFilteredSorted()`, `selectPageSorted()` ; `paginateWith()` et `paginateSortedWith()`, qui retournent un tableau ; `paginateResultWith()`, `paginateSortedResultWith()`, `paginateResultMappedWith()` et `paginateResultFromQuery($sql, $countSql, $request->query)`, qui retournent un `PaginatedResult`. Les variantes sans `With` prennent un numéro de page et une taille au lieu d’un `PaginationRequest`.

## Bon à savoir

- Laissez toujours le framework lier les valeurs. Le texte SQL lui-même ne doit jamais contenir de données issues de la requête : `SortRequest` et `FilterRequest` existent pour que les identifiants proviennent de votre liste d’autorisation.
- Les requêtes de filtre et de tri s’ajoutent à votre requête, de sorte que la requête de données et la requête de comptage ne doivent pas contenir déjà `WHERE` ou `ORDER BY`. Ajoutez plutôt les conditions fixes dans une sous-requête ou une vue. Utilisez des marqueurs nommés comme `:min` et liez-les par le dernier argument `$params`. Le filtre lui-même lie des paramètres nommés, donc un `?` positionnel serait refusé comme un mélange :

  ```php
  $result = $db->paginateFilteredSortedResultWith(
      'SELECT id, name, status FROM (SELECT * FROM project WHERE budget >= :min) AS p',
      'SELECT count(*) FROM (SELECT * FROM project WHERE budget >= :min) AS p',
      $filter, ['status' => 'status'], $sort, $page, ['min' => '100'],
  );
  ```
- Passez une requête de comptage qui correspond à la requête de données. Ce sont deux instructions distinctes, et le total provient du comptage.
- Les insertions retournent les identifiants par `RETURNING` uniquement (`insertGetId()` dans `Database`, `insertRowGetId()` dans un `Broker`).
- Gardez une transaction courte et laissez les exceptions s’en échapper.
- `Database::setSharedColumnMetadataEnabled()`, `flushSharedColumnMetadata()` et la clé `column_cache_version` relèvent du [cache des types de colonnes](#cache-des-types-de-colonnes), qu’APCu partage entre les requêtes lorsqu’il est installé. La plupart des applications n’y touchent jamais.
