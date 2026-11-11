---
title: Accès aux données
order: 12
description: Connectez-vous à PostgreSQL, exécutez des requêtes paramétrées et des transactions, hydratez des entités et construisez des listes paginées, triées et filtrées à partir des paramètres de la requête.
---

# Accès aux données

Votre SQL. Votre modèle de données.

Zephyrus communique avec PostgreSQL par l'entremise de `Zephyrus\Data\Database`, une mince couche au-dessus de PDO. Vous écrivez le SQL, le framework lie les paramètres, convertit les types de colonnes et signale les échecs. Il n'y a ni générateur de requêtes ni ORM : une requête est une chaîne de caractères que vous pouvez lire.

## Connexion

Ajoutez une section `database:` à `config.yml`. Les secrets proviennent de l'environnement avec `!env`, jamais du fichier :

```yaml
database:
  host: !env DB_HOST, localhost
  port: !env DB_PORT, 5432
  database: !env DB_NAME, app
  username: !env DB_USERNAME, app
  password: !env DB_PASSWORD
```

`database` et `username` sont obligatoires. Les autres clés sont `driver` (seulement `pgsql`), `charset` (`utf8` par défaut), `ssl_mode` (`disable`, `allow`, `prefer`, `require`, `verify-ca` ou `verify-full`), `ssl_root_cert` et `column_cache_version`. Toute autre clé interrompt le démarrage en proposant l'orthographe acceptée la plus proche. La section est interprétée en un `DatabaseConfig`, accessible par `$config->database` (`null` lorsque la section est absente).

```php
use Zephyrus\Core\Config\Configuration;
use Zephyrus\Data\Database;

$config = Configuration::fromYamlFile($root . '/config.yml');
$db = Database::fromConfig($config->database);
```

`fromConfig()` ouvre la connexion avec des requêtes préparées côté serveur : le SQL et les valeurs voyagent toujours séparément, et il est impossible de désactiver ce comportement. Une connexion qui échoue lève une `DatabaseException` qui nomme le DSN (hôte, port, base de données, jamais le mot de passe) et la raison fournie par le pilote : journalisez-la, ne l'affichez pas.

`Database` n'est pas créée pour vous. Construisez-la une seule fois et transmettez-la à vos courtiers, ou enregistrez-la dans le [conteneur](../../digging-deeper/container-and-events/) pour que les contrôleurs et les courtiers la reçoivent par leur constructeur :

```php
use Zephyrus\Container\Container;

$container = new Container();
$container->singleton(Database::class, static fn (): Database => Database::fromConfig($config->database));

$builder = $builder->withContainer($container);
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
| `count($sql, $params)` | un `int` issu d'un `SELECT count(*)` |
| `exists($sql, $params)` | `true` lorsque la première colonne est évaluée comme vraie |

Celles-ci écrivent et retournent le nombre de lignes touchées :

| Méthode | Usage |
|---|---|
| `execute`, `insert`, `update`, `delete` | le même appel sous quatre noms, pour la lisibilité |
| `insertGetId($sql, $params)` | un `INSERT ... RETURNING id`, qui retourne l'identifiant sous forme de chaîne (ou `false` si aucune ligne n'est revenue) |

```php
$id = (int) $db->insertGetId(
    'INSERT INTO project (name, budget) VALUES (?, ?) RETURNING id',
    ['Alpha', '1200.00'],
);
$db->update('UPDATE project SET archived = ? WHERE id = ?', [true, $id]);
```

Avec PostgreSQL, l'identifiant revient uniquement par `RETURNING`. `insertGetId()` refuse une instruction qui en est dépourvue, et `lastInsertId()` est refusée, car elle peut désigner la séquence d'une autre table.

Les paramètres sont liés selon leur type : `null`, entiers, nombres à virgule flottante, chaînes, booléens, `DateTimeInterface`, `BackedEnum` (sa valeur de support), `Stringable`, `Binary` et flux. Un tableau n'a pas de forme SQL et lève une `InvalidArgumentException` : voyez [Types PostgreSQL](#postgresql-types) pour les listes. Chaque appel exécute une seule instruction : `"INSERT ...; INSERT ..."` échoue et n'insère rien.

`query()` retourne le `PDOStatement` brut et `pdo()` la connexion, pour les rares cas que les aides ne couvrent pas. Une instruction exécutée par `pdo()` n'est pas suivie par `transaction()`.

`new Database($pdo)` enveloppe une connexion PDO que vous avez ouverte vous-même (une base de données de test, par exemple) : elle y force les exceptions, les lignes sous forme d'objets et les requêtes préparées côté serveur. `inTransaction()` indique si une transaction est ouverte à l'instant même : ne mettez pas la réponse en cache.

## Transactions

`transaction()` exécute une fonction de rappel, confirme lorsqu'elle retourne et annule lorsqu'elle lève une exception. La fonction reçoit la `Database`, et sa valeur de retour est retournée :

```php
$orderId = $db->transaction(function (Database $db): int {
    $id = (int) $db->insertGetId('INSERT INTO orders (total) VALUES (?) RETURNING id', ['40.00']);
    $db->insert('INSERT INTO order_line (order_id, sku) VALUES (?, ?)', [$id, 'A-100']);

    return $id;
});
```

Appelée à l'intérieur d'une transaction ouverte, `transaction()` ouvre un point de sauvegarde : un échec n'annule que les écritures internes, et une exception interceptée à l'extérieur de l'appel interne laisse le travail externe intact.

N'interceptez pas une instruction en échec à l'intérieur de la fonction pour poursuivre ensuite. PostgreSQL interrompt la transaction à la première erreur, de sorte que la confirmation deviendrait silencieusement une annulation. Le framework le détecte et lève une `DatabaseException` (SQLSTATE `25P02`) plutôt que de signaler un succès. Laissez l'exception se propager, ou interceptez-la autour d'un `transaction()` imbriqué.

## Types PostgreSQL

Les lignes reviennent converties : entiers, nombres à virgule flottante et booléens en scalaires PHP, tableaux PostgreSQL en tableaux PHP, `json` et `jsonb` décodés (les objets en `stdClass`), horodatages et dates en chaînes.

**Tableaux.** La lecture est automatique. L'écriture exige un littéral de tableau PostgreSQL accompagné d'une conversion de type, ce qui garde la valeur comme un seul paramètre lié :

```php
$db->insert('INSERT INTO project (name, tags) VALUES (?, ?::text[])', ['Gamma', '{"php","sql"}']);
$rows = $db->select('SELECT id, name FROM project WHERE id = ANY(?::bigint[])', ['{1,2,3}']);
$row = $db->selectOne('SELECT tags FROM project WHERE name = ?', ['Gamma']);
// $row->tags === ['php', 'sql']
```

Construisez le littéral vous-même en mettant chaque élément entre guillemets doubles et en échappant `"` et `\` (une petite aide privée dans le courtier suffit).

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

**Nombres exacts.** Les colonnes `NUMERIC` et `DECIMAL` deviennent des nombres à virgule flottante PHP, ce qui fait perdre des chiffres sur les montants élevés. Pour l'argent, enregistrez une conversion transparente afin que la valeur reste la chaîne exacte envoyée par PostgreSQL :

```php
$db->registerTypeConversion('NUMERIC', static fn (string $value): string => $value);
// 12345678901234567.89 stays '12345678901234567.89'
```

Enregistrez-la immédiatement après avoir créé la `Database`. Les convertisseurs sont indexés par le nom du type PostgreSQL et reçoivent la chaîne brute.

## Courtiers, services et entités

Les applications bâties sur Zephyrus répartissent habituellement le code de données en trois parties, typiquement sous `app/Models/<Domain>/{Brokers,Services,Entities}`. Seules `Broker` et `Entity` sont des classes du framework; la répartition elle-même est une convention.

Un **courtier** (broker) contient le SQL d'un domaine. Il étend `Zephyrus\Data\Broker`, reçoit la `Database` et expose les méthodes de requête sous forme d'aides protégées (`select`, `selectOne`, `selectValue`, `selectInt`, `selectString`, `selectBool`, `selectFloat`, `selectCount`, `exists`, `selectPage`, les autres méthodes de pagination, `execute`, `transaction`). `selectString()`, `selectBool()` et `selectFloat()` lisent la première colonne de la première ligne sous la forme d'un `?string`, d'un `bool` ou d'un `float` (avec une valeur par défaut), et `selectPage($sql, $page, $perPage, $params)` retourne une page de lignes sous forme de liste. `execute()` exécute n'importe quelle instruction et retourne le nombre de lignes touchées. `lastInsertId()` est aussi présente, et refusée avec PostgreSQL comme son équivalent de `Database`. Les écritures se nomment `insertRow`, `insertRowGetId`, `updateRows` et `deleteRows`, afin de ne pas entrer en collision avec les noms de vos propres méthodes :

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

Une **entité** est un objet typé hydraté à partir d'une ligne. Les propriétés sont publiques et portent le nom des colonnes :

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

Un **service** est une classe ordinaire qui appelle le courtier et hydrate les entités. `Project::build($row)` retourne `null` pour une ligne `null`; `Project::buildArray($rows)` hydrate une liste :

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

### Règles d'hydratation

- Chaque colonne est convertie vers le type déclaré de la propriété du même nom. Une colonne sans propriété publique correspondante est ignorée; `getRawData()` retourne la ligne d'origine complète.
- Une colonne nommée en `snake_case` a besoin d'un alias (`created_at AS "createdAt"`) pour atteindre une propriété en `camelCase`.
- Une propriété de type énumération à valeur de support passe par `Enum::from()`. Une valeur hors de l'énumération lève une `InvalidArgumentException` qui nomme la propriété, non la valeur.
- Une propriété `stdClass` conserve l'objet JSON décodé. Une propriété typée par une autre `Entity` est construite à partir d'une colonne contenant un objet JSON.
- Un `null` est affecté tel quel : déclarez chaque colonne nullable en `?type`, faute de quoi l'hydratation lève une `TypeError`.
- Une propriété typée par une autre classe (par exemple `DateTimeImmutable`), un type union ou une propriété privée n'est pas hydratée. Une propriété `DateTimeImmutable` reste non initialisée : lisez donc les dates sous forme de chaînes ou convertissez-les dans le service.
- Les propriétés privées et statiques, ainsi qu'une colonne nommée `rawData`, sont ignorées.

### Sérialisation des entités

`json_encode($entity)` émet les propriétés publiques qui ont été affectées et omet celles marquées `#[JsonIgnore]` (empreintes de mots de passe, identifiants internes). Seules les entités respectent l'attribut : une ligne `stdClass`, ou les éléments d'un `PaginatedResult`, sérialisent chaque colonne sélectionnée. Sélectionnez des colonnes explicites, ou hydratez avant de sérialiser.

## Erreurs

Chaque échec de la couche de données est une `DatabaseException`. Son message contient le SQLSTATE et rien d'autre, ce qui permet de le journaliser sans divulguer de valeurs :

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

Aiguillez selon `sqlState()` (par exemple `23505` pour une violation d'unicité, `23503` pour une clé étrangère). Journalisez `driverMessage()` et `sql()`, mais ne les montrez jamais à un visiteur : le texte du pilote peut contenir des valeurs de colonnes.

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

- `PaginationRequest::fromQuery()` lit `page` (ou `offset`) et `per_page` (aussi `perPage`, `page_size`, `pageSize`, `limit`). La taille de page est bornée entre 1 et `maxPerPage`, de sorte que `per_page=500` ne peut pas réclamer 500 lignes, et la page est bornée pour que le décalage ne puisse pas déborder : une page au-delà de la dernière retourne une liste vide, elle n'échoue pas. `fromArrayWithBounds()` est le même appel. `fromArray()` n'applique aucun plafond sans son argument `maxPerPage` : utilisez-la pour des valeurs déjà validées, jamais pour une requête brute.
- `SortRequest::fromQuery()` exige une liste blanche de colonnes. Une colonne qui n'en fait pas partie, y compris toute tentative d'injection, retombe sur la colonne par défaut. Elle lit `sort` (`name` en ordre croissant, `-name` en ordre décroissant), `sort_by` ou `orderBy`, ainsi que `sort_dir` ou `direction`. `fromArray()` est destinée aux entrées validées et accepte toute colonne ayant la forme d'un identifiant, sauf si vous passez `allowedColumns`.
- `$sort->toSql()` commence déjà par ` ORDER BY` et met l'identifiant entre guillemets : n'écrivez jamais `ORDER BY` avant.
- `FilterRequest::fromQuery()` ne conserve que les clés permises et construit des conditions d'égalité exacte : `status=active` devient `"status" = :f_status`, une clé répétée (`status[]=a&status[]=b`) devient une liste `IN`, et un troisième argument énumère les clés lues comme des valeurs séparées par des virgules. Les valeurs sont des paramètres liés. Les clés absentes de la correspondance de colonnes que vous passez à la méthode de requête sont ignorées.

Le résultat est un `PaginatedResult` :

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

Les pièces plus petites se trouvent à la fois sur `Database` et sur `Broker` : `selectPageWith()`, `selectSorted()`, `selectFiltered()`, `selectFilteredSorted()`, `selectPageSorted()`; `paginateWith()` et `paginateSortedWith()`, qui retournent un tableau; `paginateResultWith()`, `paginateSortedResultWith()`, `paginateResultMappedWith()` et `paginateResultFromQuery($sql, $countSql, $request->query)`, qui retournent un `PaginatedResult`. Les variantes sans `With` prennent un numéro de page et une taille au lieu d'un `PaginationRequest`.

## Bon à savoir

- Laissez toujours le framework lier les valeurs. Le texte SQL lui-même ne doit jamais contenir de données issues de la requête : `SortRequest` et `FilterRequest` existent pour que les identifiants proviennent de votre liste blanche.
- Les requêtes de filtre et de tri s'ajoutent à votre requête, de sorte que la requête de données et la requête de comptage ne doivent pas contenir déjà `WHERE` ou `ORDER BY`. Ajoutez plutôt les conditions fixes dans une sous-requête ou une vue. Utilisez des marqueurs nommés comme `:min` et liez-les par le dernier argument `$params`. Le filtre lui-même lie des paramètres nommés, donc un `?` positionnel serait refusé comme un mélange :

  ```php
  $result = $db->paginateFilteredSortedResultWith(
      'SELECT id, name, status FROM (SELECT * FROM project WHERE budget >= :min) AS p',
      'SELECT count(*) FROM (SELECT * FROM project WHERE budget >= :min) AS p',
      $filter, ['status' => 'status'], $sort, $page, ['min' => '100'],
  );
  ```
- Passez une requête de comptage qui correspond à la requête de données. Ce sont deux instructions distinctes, et le total provient du comptage.
- Les insertions retournent les identifiants par `RETURNING` uniquement (`insertGetId()` dans `Database`, `insertRowGetId()` dans un `Broker`).
- Gardez une transaction courte et laissez les exceptions s'en échapper.
- `Database::setSharedColumnMetadataEnabled()`, `flushSharedColumnMetadata()` et la clé `column_cache_version` relèvent du cache des types de colonnes, que APCu partage entre les requêtes lorsqu'il est installé. La plupart des applications n'y touchent jamais.
