# 30-Second Demo GIF Script

Record your screen (terminal + browser side by side) showing xhtmlx in action.
Use a tool like [Gifox](https://gifox.app), [LICEcap](https://www.cockos.com/licecap/), or `ffmpeg`.

## Setup before recording

1. Open browser to `http://localhost:3000`
2. Open `examples/basic-get.html` in your editor
3. Have terminal ready with `node examples/server.js` running
4. Browser window: 800x600, dark theme

## Script (30 seconds)

### Scene 1: The HTML (5 seconds)
Show this code in the editor — highlight the key attributes:

```html
<div xh-get="/api/users"
     xh-trigger="load"
     xh-template="/templates/user-list.html">
  <span class="xh-indicator">Loading...</span>
</div>
```

**Caption:** "5 lines of HTML. No JavaScript."

### Scene 2: The template (5 seconds)
Show the template file:

```html
<div xh-each="users">
  <h3 xh-text="name"></h3>
  <p xh-text="email"></p>
  <span xh-if="is_admin" class="badge">Admin</span>
</div>
```

**Caption:** "Template renders JSON from your REST API"

### Scene 3: The result (5 seconds)
Switch to browser — page loads, loading indicator shows briefly, user cards appear.

**Caption:** "Server returns JSON. Browser renders the UI."

### Scene 4: Add a feature (10 seconds)
Add a search input to the HTML:

```html
<input xh-get="/api/search"
       xh-trigger="keyup changed delay:300ms"
       xh-target="#results">
```

Type "Ali" in the browser — results filter in real time.

**Caption:** "Search with debounce. Still no JavaScript."

### Scene 5: The punchline (5 seconds)
Show terminal: `wc -c xhtmlx.min.js` → show the file size.

**Caption:** "~10KB gzipped. Zero dependencies. github.com/teryxjs/xhtmlx"

## Tips

- Use a large font size in editor (18-20px)
- Use a dark theme (matches the site)
- Keep mouse movements smooth and deliberate
- Aim for 800x450 or 1200x675 resolution
- Optimize the GIF: `gifsicle -O3 --lossy=80 demo.gif -o demo-optimized.gif`
- Keep it under 5MB for GitHub README, under 15MB for Twitter

## Alternative: Record the playground

Even simpler — just record the playground at teryxjs.github.io/xhtmlx/playground/:
1. Select "Basic GET" from dropdown → preview renders
2. Select "Search with Debounce" → type something → results appear
3. Select "xh-model + Reactivity" → edit input → text updates live

This shows everything without needing a local server.
