const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = 3333;
const DOCS_DIR = path.join(__dirname, "../../docs");
const ROOT_DIR = path.join(__dirname, "../..");
const FIXTURES_DIR = path.join(__dirname, "fixtures");

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
};

// In-memory data store
let users = [
  { id: 1, name: "Alice", email: "alice@example.com", role: "admin" },
  { id: 2, name: "Bob", email: "bob@example.com", role: "user" },
  { id: 3, name: "Charlie", email: "charlie@example.com", role: "user" },
];
let nextUserId = 4;

const server = http.createServer((req, res) => {
  const urlObj = new URL(req.url, "http://localhost:" + PORT);
  const url = urlObj.pathname;
  const query = Object.fromEntries(urlObj.searchParams);
  const method = req.method;

  // Collect request body
  let body = "";
  req.on("data", chunk => body += chunk);
  req.on("end", () => {
    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,PATCH");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // API routes
    if (url.startsWith("/api/")) {
      res.setHeader("Content-Type", "application/json");
      handleAPI(method, url, query, body, res);
      return;
    }

    // Serve test fixtures
    if (url.startsWith("/test/")) {
      const fixturePath = path.join(FIXTURES_DIR, url.replace("/test/", ""));
      serveFile(fixturePath, res);
      return;
    }

    // Serve templates
    if (url.startsWith("/templates/")) {
      const tplPath = path.join(FIXTURES_DIR, url);
      serveFile(tplPath, res);
      return;
    }

    // Serve from docs/ (playground, site)
    let filePath = path.join(DOCS_DIR, url);
    if (!fs.existsSync(filePath)) filePath = path.join(ROOT_DIR, url);
    if (!fs.existsSync(filePath)) {
      const indexPath = path.join(filePath, "index.html");
      if (fs.existsSync(indexPath)) filePath = indexPath;
    }
    serveFile(filePath, res);
  });
});

function handleAPI(method, url, query, body, res) {
  let parsedBody = {};
  try { parsedBody = JSON.parse(body); } catch(e) {}

  // GET /api/users
  if (method === "GET" && url === "/api/users") {
    const q = query.q;
    let result = users;
    if (q) result = users.filter(u => u.name.toLowerCase().includes(q.toLowerCase()));
    res.writeHead(200);
    res.end(JSON.stringify({ users: result }));
    return;
  }

  // GET /api/users/:id
  const userMatch = url.match(/^\/api\/users\/(\d+)$/);
  if (method === "GET" && userMatch) {
    const user = users.find(u => u.id === parseInt(userMatch[1]));
    if (user) {
      res.writeHead(200);
      res.end(JSON.stringify(user));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found", message: "User not found" }));
    }
    return;
  }

  // POST /api/users
  if (method === "POST" && url === "/api/users") {
    const newUser = { id: nextUserId++, ...parsedBody };
    users.push(newUser);
    res.writeHead(201);
    res.end(JSON.stringify(newUser));
    return;
  }

  // PUT /api/users/:id
  if (method === "PUT" && userMatch) {
    const idx = users.findIndex(u => u.id === parseInt(userMatch[1]));
    if (idx !== -1) {
      users[idx] = { ...users[idx], ...parsedBody };
      res.writeHead(200);
      res.end(JSON.stringify(users[idx]));
    } else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found" }));
    }
    return;
  }

  // DELETE /api/users/:id
  if (method === "DELETE" && userMatch) {
    users = users.filter(u => u.id !== parseInt(userMatch[1]));
    res.writeHead(204);
    res.end();
    return;
  }

  // GET /api/users/:id/posts
  const postsMatch = url.match(/^\/api\/users\/(\d+)\/posts$/);
  if (method === "GET" && postsMatch) {
    res.writeHead(200);
    res.end(JSON.stringify({ posts: [
      { id: 1, title: "First Post by User " + postsMatch[1], body: "Content of the first post" },
      { id: 2, title: "Second Post by User " + postsMatch[1], body: "Content of the second post" },
    ]}));
    return;
  }

  // GET /api/posts/:id/comments
  const commentsMatch = url.match(/^\/api\/posts\/(\d+)\/comments$/);
  if (method === "GET" && commentsMatch) {
    res.writeHead(200);
    res.end(JSON.stringify({ comments: [
      { id: 1, text: "Great post!", author: "Dave" },
      { id: 2, text: "Thanks for sharing", author: "Eve" },
    ]}));
    return;
  }

  // GET /api/search?q=...
  if (method === "GET" && url === "/api/search") {
    const q = query.q || "";
    const results = users.filter(u => u.name.toLowerCase().includes(q.toLowerCase()));
    res.writeHead(200);
    res.end(JSON.stringify({ results: results, query: q }));
    return;
  }

  // GET /api/poll
  if (method === "GET" && url === "/api/poll") {
    res.writeHead(200);
    res.end(JSON.stringify({ timestamp: new Date().toISOString(), count: users.length }));
    return;
  }

  // Error endpoints
  if (url === "/api/error/404") { res.writeHead(404); res.end(JSON.stringify({ error: "not_found", message: "Resource not found" })); return; }
  if (url === "/api/error/500") { res.writeHead(500); res.end(JSON.stringify({ error: "server_error", message: "Internal server error" })); return; }
  if (url === "/api/error/422") { res.writeHead(422); res.end(JSON.stringify({ error: "validation", message: "Validation failed", fields: [{ name: "email", message: "Invalid format" }] })); return; }

  // GET /api/todos
  if (method === "GET" && url === "/api/todos") {
    res.writeHead(200);
    res.end(JSON.stringify({ todos: [
      { id: 1, title: "Learn xhtmlx", completed: true },
      { id: 2, title: "Build an app", completed: false },
      { id: 3, title: "Deploy", completed: false },
    ]}));
    return;
  }

  // Fallback
  res.writeHead(404);
  res.end(JSON.stringify({ error: "not_found" }));
}

function serveFile(filePath, res) {
  if (!fs.existsSync(filePath)) {
    // Try index.html
    const indexPath = path.join(filePath, "index.html");
    if (fs.existsSync(indexPath)) filePath = indexPath;
    else { res.writeHead(404); res.end("Not found: " + filePath); return; }
  }
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) {
    filePath = path.join(filePath, "index.html");
    if (!fs.existsSync(filePath)) { res.writeHead(404); res.end("Not found"); return; }
  }
  const ext = path.extname(filePath);
  res.writeHead(200, { "Content-Type": MIME[ext] || "text/plain" });
  fs.createReadStream(filePath).pipe(res);
}

// Reset data between test runs
server.on("request", (req) => {
  if (req.url === "/api/__reset") {
    users = [
      { id: 1, name: "Alice", email: "alice@example.com", role: "admin" },
      { id: 2, name: "Bob", email: "bob@example.com", role: "user" },
      { id: 3, name: "Charlie", email: "charlie@example.com", role: "user" },
    ];
    nextUserId = 4;
  }
});

server.listen(PORT, () => {
  console.log("Test server on http://localhost:" + PORT);
});
