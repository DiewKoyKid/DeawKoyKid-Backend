require("dotenv").config();
const express = require("express");
const cookieParser = require("cookie-parser");
const authRoutes = require("./src/routes/auth.routes");

const app = express();

app.use(express.json());
app.use(cookieParser());

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});


const userRoutes = require("./src/routes/user.routes");
app.use("/api/users", userRoutes);