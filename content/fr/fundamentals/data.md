---
title: Accès aux données
order: 5
description: SQL explicite, Brokers et objets Entity dans Zephyrus.
---

# Accès aux données

Votre SQL. Votre modèle de données.

Les Brokers regroupent les requêtes SQL d’un domaine. Les méthodes utilitaires gèrent les paramètres liés et le retour des données, tout en gardant la requête visible.

## Une requête explicite

```php
use stdClass;
use Zephyrus\Data\Broker;

final class ProductBroker extends Broker
{
    public function find(int $id): ?stdClass
    {
        return $this->selectOne(
            'SELECT id, name FROM product WHERE id = ?',
            [$id]
        );
    }
}
```

## Une place pour chaque responsabilité

Le Broker rassemble les accès SQL. Les services portent la logique applicative. Les objets `Entity` peuvent hydrater les lignes en objets typés.

## Ce qui suivra

> **Référence en préparation**
> L’injection de la connexion, les transactions et les exemples complets seront vérifiés avec le core mis à jour.
