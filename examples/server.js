const express = require("express");
const path = require("path");

const app = express();
const PORT = 3000;

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(express.json());

// Serve project root (so /xhtmlx.js works)
app.use(express.static(path.join(__dirname, "..")));

// Serve examples directory at /examples and also at root for convenience
app.use("/examples", express.static(__dirname));
app.use(express.static(__dirname));

// Artificial delay to make indicators visible
app.use("/api", (req, res, next) => {
  setTimeout(next, 400);
});

// ---------------------------------------------------------------------------
// In-memory data store
// ---------------------------------------------------------------------------
let nextUserId = 6;
let nextPostId = 20;
let nextCommentId = 100;

let users = [
  { id: 1, name: "Alice Johnson",  email: "alice@example.com",  avatar: "https://i.pravatar.cc/80?u=alice",  is_admin: true,  verified: true  },
  { id: 2, name: "Bob Smith",      email: "bob@example.com",    avatar: "https://i.pravatar.cc/80?u=bob",    is_admin: false, verified: true  },
  { id: 3, name: "Carol Williams", email: "carol@example.com",  avatar: "https://i.pravatar.cc/80?u=carol",  is_admin: false, verified: false },
  { id: 4, name: "Dave Brown",     email: "dave@example.com",   avatar: "https://i.pravatar.cc/80?u=dave",   is_admin: true,  verified: true  },
  { id: 5, name: "Eve Davis",      email: "eve@example.com",    avatar: "https://i.pravatar.cc/80?u=eve",    is_admin: false, verified: false },
];

let posts = [
  { id: 1,  user_id: 1, title: "Getting Started with xhtmlx",       body: "xhtmlx makes it easy to build dynamic UIs with REST APIs." },
  { id: 2,  user_id: 1, title: "Template Composition Patterns",     body: "Learn how to compose templates for complex UIs." },
  { id: 3,  user_id: 2, title: "REST API Best Practices",           body: "Design your APIs for declarative HTML consumption." },
  { id: 4,  user_id: 2, title: "Client-Side vs Server-Side",        body: "Comparing rendering approaches for web apps." },
  { id: 5,  user_id: 3, title: "CSS for Loading States",            body: "Make your loading indicators look great." },
  { id: 6,  user_id: 4, title: "Error Handling Done Right",         body: "Gracefully handle errors in declarative UIs." },
  { id: 7,  user_id: 4, title: "Polling and Real-time Updates",     body: "Use xh-trigger every to keep data fresh." },
  { id: 8,  user_id: 5, title: "Forms Without JavaScript",          body: "Submit forms declaratively with xhtmlx." },
];

let comments = [
  { id: 1,  post_id: 1, author: "Bob",   text: "Great introduction!" },
  { id: 2,  post_id: 1, author: "Carol", text: "Very helpful, thanks." },
  { id: 3,  post_id: 2, author: "Dave",  text: "I use this pattern all the time." },
  { id: 4,  post_id: 3, author: "Alice", text: "Solid advice on API design." },
  { id: 5,  post_id: 3, author: "Eve",   text: "Would love more examples." },
  { id: 6,  post_id: 4, author: "Carol", text: "Interesting comparison." },
  { id: 7,  post_id: 5, author: "Alice", text: "Love the spinner CSS tricks." },
  { id: 8,  post_id: 6, author: "Bob",   text: "Error templates are a game changer." },
  { id: 9,  post_id: 7, author: "Eve",   text: "Polling works surprisingly well." },
  { id: 10, post_id: 8, author: "Dave",  text: "No JS forms are the future." },
];

// ---------------------------------------------------------------------------
// API Routes — Users
// ---------------------------------------------------------------------------

// List all users
app.get("/api/users", (req, res) => {
  res.json({ users });
});

// Get single user
app.get("/api/users/:id", (req, res) => {
  const user = users.find((u) => u.id === parseInt(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json(user);
});

// Create user
app.post("/api/users", (req, res) => {
  const newUser = {
    id: nextUserId++,
    name: req.body.name || "New User",
    email: req.body.email || "new@example.com",
    avatar: "https://i.pravatar.cc/80?u=" + (req.body.name || "new").toLowerCase().replace(/\s/g, ""),
    is_admin: req.body.is_admin || false,
    verified: false,
  };
  users.push(newUser);
  res.status(201).json(newUser);
});

// Update user
app.put("/api/users/:id", (req, res) => {
  const idx = users.findIndex((u) => u.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  users[idx] = { ...users[idx], ...req.body, id: users[idx].id };
  res.json(users[idx]);
});

// Delete user
app.delete("/api/users/:id", (req, res) => {
  const idx = users.findIndex((u) => u.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  const deleted = users.splice(idx, 1)[0];
  res.json({ deleted: true, user: deleted });
});

// ---------------------------------------------------------------------------
// API Routes — Posts & Comments
// ---------------------------------------------------------------------------

// Posts for a user
app.get("/api/users/:id/posts", (req, res) => {
  const userPosts = posts.filter((p) => p.user_id === parseInt(req.params.id));
  res.json({ posts: userPosts });
});

// Comments for a post
app.get("/api/posts/:id/comments", (req, res) => {
  const postComments = comments.filter((c) => c.post_id === parseInt(req.params.id));
  res.json({ comments: postComments });
});

// ---------------------------------------------------------------------------
// API Routes — Search
// ---------------------------------------------------------------------------

app.get("/api/search", (req, res) => {
  const q = (req.query.q || "").toLowerCase();
  if (!q) return res.json({ users: [], query: q });
  const results = users.filter(
    (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  );
  res.json({ users: results, query: q });
});

// ---------------------------------------------------------------------------
// API Routes — Error endpoints
// ---------------------------------------------------------------------------

app.get("/api/error/400", (req, res) => {
  res.status(400).json({ error: "bad_request", message: "The request was malformed or invalid." });
});

app.get("/api/error/404", (req, res) => {
  res.status(404).json({ error: "not_found", message: "The requested resource was not found." });
});

app.get("/api/error/422", (req, res) => {
  res.status(422).json({
    error: "validation_failed",
    message: "One or more fields failed validation.",
    fields: [
      { name: "name",  message: "Name is required and must be at least 2 characters." },
      { name: "email", message: "Email must be a valid email address." },
      { name: "age",   message: "Age must be a positive number." },
    ],
  });
});

app.get("/api/error/500", (req, res) => {
  res.status(500).json({ error: "internal_error", message: "An unexpected server error occurred." });
});

// ---------------------------------------------------------------------------
// API Routes — Widget endpoints (for error boundary examples)
// ---------------------------------------------------------------------------

app.get("/api/widget/success", (req, res) => {
  res.json({ message: "Widget loaded successfully", data: [1, 2, 3] });
});

app.get("/api/widget/fail-400", (req, res) => {
  res.status(400).json({ error: "bad_request", message: "Invalid widget parameters" });
});

app.get("/api/widget/fail-404", (req, res) => {
  res.status(404).json({ error: "not_found", message: "Widget not found" });
});

app.get("/api/widget/fail-500", (req, res) => {
  res.status(500).json({ error: "server_error", message: "Internal server error" });
});

app.get("/api/widget/fail-422", (req, res) => {
  res.status(422).json({
    error: "validation",
    message: "Validation failed",
    fields: [
      { name: "size", message: "Must be positive" },
      { name: "color", message: "Invalid color" },
    ],
  });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`xhtmlx examples server running at http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT}/index.html to browse examples.`);
});
