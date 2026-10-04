# Valgharie

Site Valgharie avec galerie Minecraft et authentification par email.

## Inscription / connexion

L'inscription demande :
- une adresse email ;
- un mot de passe.

Après l'inscription, un **email de vérification** est envoyé à la même adresse.
Le compte ne peut pas se connecter tant que l'adresse n'est pas vérifiée.

La connexion se fait ensuite avec **la même adresse email + le même mot de passe**.

Le lien de vérification expire après 30 minutes. Une procédure « mot de passe oublié » est également incluse.

## Configuration email

Pour envoyer réellement les emails, définir les variables d'environnement :

```text
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=...
SESSION_SECRET=une-longue-valeur-secrete
BASE_URL=https://ton-domaine.fr
```

Sans SMTP configuré, le serveur affiche le lien de vérification dans la console pour les tests locaux.

## Lancer

```bash
npm install
npm start
```

Puis ouvrir `http://localhost:3000`.

Pour un vrai déploiement : HTTPS, secret de session robuste, limitation de tentatives de connexion, protection CSRF/rate limiting, sauvegardes de base et fournisseur SMTP fiable.


## Panel administrateur

Deux comptes administrateur sont prévus dans cette version : un rôle **Fondatrice** et un rôle **Développeur**. Ils peuvent désormais se connecter depuis le bouton « Connexion » du site avec leurs adresses e-mail. Les mots de passe sont hachés avec `scrypt` et ne sont pas stockés en clair dans SQLite après création.

- `/admin.html` : panel admin
- Fondatrice : `viewelvalghar@gmail.com` — accès complet, y compris gestion des utilisateurs
- Développeur : `Leroutier87@gmail.com` — accès au tableau de bord technique

**Important :** les identifiants initiaux sont ceux demandés pour cette version de développement. Change-les avant de publier le site.

## Page Lives

- `/live.html`
- Lecteur Twitch intégré pour `viewel_valghar`
- Bouton de secours vers Twitch
- En production, le domaine du site doit être compatible avec le paramètre `parent` du lecteur Twitch.


## Gestion de la galerie

L'accueil ne permet plus d'ajouter directement des images. Les images se gèrent depuis `/admin.html` :
1. un administrateur envoie une image ;
2. elle arrive en **En attente** ;
3. la **Fondatrice** clique sur **✓ Valider** ;
4. l'image apparaît alors automatiquement dans la galerie de l'accueil.

Les fichiers envoyés sont stockés dans `uploads/` et les images acceptées sont enregistrées dans SQLite.

## Tous les lives

`/live.html` affiche toutes les chaînes Twitch configurées. Depuis le panel admin, l'équipe peut ajouter ou retirer des chaînes.
