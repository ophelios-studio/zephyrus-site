---
title: Configuration
order: 3
description: Un aperçu de la configuration de Zephyrus.
---

# Configuration

Votre environnement, au même endroit.

Zephyrus utilise une configuration YAML avec des valeurs d’environnement et des sections typées. Ce chapitre expliquera les réglages du framework mis à jour.

## Un point de départ lisible

Cet aperçu montre le style de configuration utilisé par un site Leaf construit sur Zephyrus.

```yaml
application:
  environment: !env APP_ENV, dev
  debug: !env APP_DEBUG, true

render:
  engine: latte
  directory: app/Views
```

## Ce que ce chapitre couvrira

- Chargement et organisation de la configuration
- Variables d’environnement et valeurs par défaut
- Sections typées
- Réglages de développement et de production

> **Référence en préparation**
> Le schéma de configuration final suivra la mise à jour du core.
