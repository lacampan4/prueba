#!/usr/bin/env python3
"""
La autenticacion de usuarios ahora vive en PostgreSQL de Render.
Este script se conserva como referencia historica y ya no modifica app.js/users.json.

Los roles y permisos se administran desde frontend/usuarios.html.
La migracion inicial de users.json a PostgreSQL la realiza backend/user-db.js
cuando DATABASE_URL esta configurada y la tabla esta vacia.
"""
print("La gestion de usuarios ahora se realiza en PostgreSQL. No se modifica app.js ni users.json desde este script.")
