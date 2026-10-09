---
title: Localisation
order: 4
description: Catalogues JSON, clés imbriquées et paramètres de traduction dans Zephyrus.
---

# Localisation

Une autre langue. Un fichier JSON.

Le chargeur de langues réunit les fichiers JSON d’un répertoire. Les clés imbriquées sont accessibles par notation avec des points, comme `demo.greeting`.

## Des messages lisibles

```json
{
  "demo": {
    "greeting": "Bonjour, {name}",
    "items": "{count} {count|plural:article:articles}"
  }
}
```

```php
localize('demo.greeting', ['name' => 'Sam']);
localize('demo.items', ['count' => 3]);
```

Les paramètres sont remplacés dans le message. Les filtres permettent notamment de changer la casse, de formater un nombre ou de choisir une forme singulière ou plurielle.

## Le repli des langues

Le traducteur cherche d’abord dans la variante demandée. Pour `fr-CA`, il essaie ensuite `fr`, puis la langue par défaut configurée.

## Ce qui suivra

> **Référence en préparation**
> Cet aperçu présente les mécanismes observés dans le core. L’initialisation, les options de cache et l’intégration complète seront documentées après la mise à jour.
