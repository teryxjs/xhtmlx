/**
 * xhtmlx Playground — Mock API Service Worker
 *
 * Intercepts fetch requests to /api/* and returns mock JSON responses.
 * Supports dynamic route updates from the main page via postMessage.
 */

const DEFAULT_ROUTES = {
  "GET /api/users": {
    status: 200,
    body: {
      users: [
        { id: 1, name: "Alice", email: "alice@example.com", role: "admin" },
        { id: 2, name: "Bob", email: "bob@example.com", role: "user" },
        { id: 3, name: "Charlie", email: "charlie@example.com", role: "user" }
      ]
    }
  },
  "GET /api/users/1": {
    status: 200,
    body: { id: 1, name: "Alice", email: "alice@example.com", role: "admin", bio: "Software engineer" }
  },
  "GET /api/users/2": {
    status: 200,
    body: { id: 2, name: "Bob", email: "bob@example.com", role: "user", bio: "Designer" }
  },
  "GET /api/users/3": {
    status: 200,
    body: { id: 3, name: "Charlie", email: "charlie@example.com", role: "user", bio: "Product manager" }
  },
  "POST /api/users": {
    status: 201,
    body: { id: 4, name: "New User", email: "new@example.com" }
  },
  "PUT /api/users/1": {
    status: 200,
    body: { id: 1, name: "Alice Updated", email: "alice@example.com", role: "admin" }
  },
  "DELETE /api/users/1": {
    status: 204,
    body: {}
  },
  "GET /api/posts": {
    status: 200,
    body: {
      posts: [
        { id: 1, title: "Hello World", body: "My first post", userId: 1 },
        { id: 2, title: "xhtmlx is great", body: "Declarative HTML attributes", userId: 1 },
        { id: 3, title: "Service Workers", body: "Mocking APIs in the browser", userId: 2 }
      ]
    }
  },
  "GET /api/posts/1": {
    status: 200,
    body: { id: 1, title: "Hello World", body: "My first post", userId: 1, tags: ["intro", "general"] }
  },
  "GET /api/todos": {
    status: 200,
    body: {
      todos: [
        { id: 1, title: "Learn xhtmlx", completed: true },
        { id: 2, title: "Build an app", completed: false },
        { id: 3, title: "Deploy to production", completed: false }
      ]
    }
  },
  "GET /api/search": {
    status: 200,
    body: {
      results: [
        { id: 1, name: "Alice", email: "alice@example.com", role: "admin" },
        { id: 2, name: "Bob", email: "bob@example.com", role: "user" },
        { id: 3, name: "Charlie", email: "charlie@example.com", role: "user" }
      ]
    }
  },
  "GET /api/error/404": {
    status: 404,
    body: { error: "not_found", message: "Resource not found" }
  },
  "GET /api/error/500": {
    status: 500,
    body: { error: "server_error", message: "Internal server error" }
  }
};

let customRoutes = {};

self.addEventListener("install", function (e) {
  self.skipWaiting();
});

self.addEventListener("activate", function (e) {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "UPDATE_ROUTES") {
    customRoutes = e.data.routes || {};
  }
});

self.addEventListener("fetch", function (e) {
  var url = new URL(e.request.url);

  // Only intercept /api/* requests
  if (!url.pathname.startsWith("/api/")) return;

  var key = e.request.method + " " + url.pathname;

  // Check custom routes first, then default routes
  var route = customRoutes[key] || DEFAULT_ROUTES[key];

  // If no exact match, try matching with query params stripped (for search)
  if (!route) {
    // Try a wildcard-style match: "GET /api/search" should match "GET /api/search?q=foo"
    var basePath = url.pathname;
    var baseKey = e.request.method + " " + basePath;
    route = customRoutes[baseKey] || DEFAULT_ROUTES[baseKey];
  }

  if (route) {
    // Add a small delay to simulate network latency
    var delay = 100 + Math.floor(Math.random() * 200);
    e.respondWith(
      new Promise(function (resolve) {
        setTimeout(function () {
          resolve(
            new Response(JSON.stringify(route.body), {
              status: route.status,
              headers: {
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*",
                "X-Mock-API": "true"
              }
            })
          );
        }, delay);
      })
    );
  }
  // If no route matched, let the request fall through (will likely 404 naturally)
});
