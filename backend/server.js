import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET;

// URL pública del frontend actual. Se conserva como respaldo para que una
// configuración anterior de FRONTEND_URL no bloquee el inicio de sesión.
const defaultAllowedOrigins = ["https://formacero.vercel.app"];

const configuredOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultAllowedOrigins, ...configuredOrigins])];

app.use(
  cors({
    origin(origin, callback) {
      // Permite herramientas locales sin Origin y, en producción, solo los
      // dominios autorizados explícitamente.
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }
      return callback(new Error("Origen no permitido"));
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "FORMACERO API" });
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, status: "online" });
});

app.post("/api/login", (req, res) => {
  const { usuario, password } = req.body || {};

  if (!usuario || !password) {
    return res.status(400).json({ message: "Usuario y contraseña son obligatorios" });
  }

  if (!process.env.ADMIN_USER || !process.env.ADMIN_PASSWORD || !JWT_SECRET) {
    console.error("Faltan variables ADMIN_USER, ADMIN_PASSWORD o JWT_SECRET en Render.");
    return res.status(500).json({ message: "El servidor no está configurado correctamente." });
  }

  if (usuario !== process.env.ADMIN_USER || password !== process.env.ADMIN_PASSWORD) {
    return res.status(401).json({ message: "Usuario o contraseña incorrectos" });
  }

  const token = jwt.sign({ usuario }, JWT_SECRET, { expiresIn: "8h" });
  return res.json({ ok: true, token, usuario });
});

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token || !JWT_SECRET) {
    return res.status(401).json({ message: "No autorizado" });
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ message: "Sesión inválida o vencida" });
  }
}

app.get("/api/me", auth, (req, res) => {
  res.json({ ok: true, usuario: req.user.usuario });
});

app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(500).json({ message: err.message || "Error interno del servidor" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`FORMACERO API ejecutándose en puerto ${PORT}`);
});
