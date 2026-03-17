#!/usr/bin/env node

"use strict";

var fs = require("fs");
var path = require("path");

// ---------------------------------------------------------------------------
// Migration rules per version pair
// ---------------------------------------------------------------------------

var MIGRATIONS = {
  "1-2": {
    description: "v1 to v2",
    rules: [
      // Example: attribute renames
      { type: "rename-attr", from: "xh-bind", to: "xh-model", description: "xh-bind renamed to xh-model" },
      // Example: value changes
      { type: "rename-value", attr: "xh-swap", from: "replace", to: "outerHTML", description: "xh-swap='replace' renamed to 'outerHTML'" },
      // Example: attribute split
      { type: "rename-attr", from: "xh-loading", to: "xh-indicator", description: "xh-loading renamed to xh-indicator" },
      // Example: new required attribute
      { type: "add-attr-if-missing", ifHas: "xh-ws", attr: "xh-trigger", value: "message", description: "xh-ws now requires explicit xh-trigger" },
    ]
  },
  "2-3": {
    description: "v2 to v3",
    rules: [
      // Placeholder for future v3 migrations
    ]
  }
};

// Reverse migrations are auto-generated
function getReverseMigration(fromTo) {
  var forward = MIGRATIONS[fromTo];
  if (!forward) return null;

  return {
    description: forward.description + " (reverse)",
    rules: forward.rules.map(function(rule) {
      if (rule.type === "rename-attr") {
        return { type: "rename-attr", from: rule.to, to: rule.from, description: rule.description + " (reversed)" };
      }
      if (rule.type === "rename-value") {
        return { type: "rename-value", attr: rule.attr, from: rule.to, to: rule.from, description: rule.description + " (reversed)" };
      }
      return rule;
    })
  };
}

// ---------------------------------------------------------------------------
// HTML attribute transformer
// ---------------------------------------------------------------------------

function applyRule(html, rule) {
  var changes = [];
  var newHtml;

  switch (rule.type) {
    case "rename-attr": {
      // Match the old attribute name in xh-* context
      var attrRegex = new RegExp('(\\s)' + escapeRegex(rule.from) + '(\\s*=)', 'g');
      newHtml = html.replace(attrRegex, function(match, pre, eq) {
        changes.push(rule.description);
        return pre + rule.to + eq;
      });
      // Also match without value (boolean attribute)
      var boolRegex = new RegExp('(\\s)' + escapeRegex(rule.from) + '([\\s>])', 'g');
      newHtml = newHtml.replace(boolRegex, function(match, pre, post) {
        if (changes.length === 0) changes.push(rule.description);
        return pre + rule.to + post;
      });
      return { html: newHtml, changes: changes };
    }

    case "rename-value": {
      // Match attr="oldvalue"
      var valRegex = new RegExp(
        '(' + escapeRegex(rule.attr) + '\\s*=\\s*["\'])' + escapeRegex(rule.from) + '(["\'])',
        'g'
      );
      newHtml = html.replace(valRegex, function(match, pre, post) {
        changes.push(rule.description);
        return pre + rule.to + post;
      });
      return { html: newHtml, changes: changes };
    }

    case "add-attr-if-missing": {
      // Find elements that have ifHas but not attr
      var hasRegex = new RegExp('<[^>]*' + escapeRegex(rule.ifHas) + '[^>]*>', 'g');
      newHtml = html.replace(hasRegex, function(tag) {
        if (tag.indexOf(rule.attr) === -1) {
          changes.push(rule.description);
          return tag.replace('>', ' ' + rule.attr + '="' + rule.value + '">');
        }
        return tag;
      });
      return { html: newHtml, changes: changes };
    }

    default:
      return { html: html, changes: [] };
  }
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function migrateFile(filePath, rules, dryRun) {
  var html = fs.readFileSync(filePath, "utf-8");
  var originalHtml = html;
  var allChanges = [];

  for (var i = 0; i < rules.length; i++) {
    var result = applyRule(html, rules[i]);
    html = result.html;
    allChanges = allChanges.concat(result.changes);
  }

  var changed = html !== originalHtml;

  if (changed && !dryRun) {
    fs.writeFileSync(filePath, html, "utf-8");
  }

  return {
    file: filePath,
    changed: changed,
    changes: allChanges
  };
}

// ---------------------------------------------------------------------------
// Simple recursive file finder (no external dependencies)
// ---------------------------------------------------------------------------

function findFiles(patterns) {
  var files = [];
  for (var p = 0; p < patterns.length; p++) {
    var pattern = patterns[p];
    if (fs.existsSync(pattern) && fs.statSync(pattern).isFile()) {
      files.push(pattern);
    } else if (fs.existsSync(pattern) && fs.statSync(pattern).isDirectory()) {
      walkDir(pattern, files);
    } else {
      // Try as a simple glob: resolve parent dir and filter
      var dir = path.dirname(pattern);
      var ext = path.extname(pattern);
      if (fs.existsSync(dir)) {
        walkDir(dir, files, ext);
      }
    }
  }
  return files;
}

function walkDir(dir, files, extFilter) {
  var entries = fs.readdirSync(dir);
  for (var i = 0; i < entries.length; i++) {
    var fullPath = path.join(dir, entries[i]);
    var stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, files, extFilter);
    } else if (stat.isFile()) {
      if (!extFilter || path.extname(fullPath) === extFilter) {
        files.push(fullPath);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log("xhtmlx-migrate — Migrate HTML files between xhtmlx versions");
  console.log("");
  console.log("Usage:");
  console.log("  npx xhtmlx-migrate --from=1 --to=2 <files...>");
  console.log("  npx xhtmlx-migrate --from=2 --to=1 --reverse <files...>");
  console.log("  npx xhtmlx-migrate --dry-run --from=1 --to=2 <files...>");
  console.log("  npx xhtmlx-migrate --list-rules --from=1 --to=2");
  console.log("");
  console.log("Options:");
  console.log("  --from=N       Source version number");
  console.log("  --to=N         Target version number");
  console.log("  --reverse      Apply migration in reverse (for rollback)");
  console.log("  --dry-run      Preview changes without writing files");
  console.log("  --list-rules   Show migration rules for the version pair");
  console.log("  --help         Show this help");
  console.log("");
  console.log("Examples:");
  console.log("  npx xhtmlx-migrate --from=1 --to=2 src/");
  console.log("  npx xhtmlx-migrate --from=1 --to=2 index.html templates/");
  console.log("  npx xhtmlx-migrate --dry-run --from=1 --to=2 **/*.html");
}

function parseArgs(args) {
  var opts = { from: null, to: null, reverse: false, dryRun: false, listRules: false, help: false, files: [] };

  for (var i = 0; i < args.length; i++) {
    var arg = args[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--reverse") opts.reverse = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--list-rules") opts.listRules = true;
    else if (arg.indexOf("--from=") === 0) opts.from = arg.slice(7);
    else if (arg.indexOf("--to=") === 0) opts.to = arg.slice(5);
    else opts.files.push(arg);
  }

  return opts;
}

function main() {
  var args = process.argv.slice(2);
  var opts = parseArgs(args);

  if (opts.help || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  if (!opts.from || !opts.to) {
    console.error("Error: --from and --to are required");
    printUsage();
    process.exit(1);
  }

  var migrationKey = opts.from + "-" + opts.to;
  var migration = opts.reverse ? getReverseMigration(migrationKey) : MIGRATIONS[migrationKey];

  if (!migration) {
    // Try reverse key
    var reverseKey = opts.to + "-" + opts.from;
    if (opts.reverse && MIGRATIONS[reverseKey]) {
      migration = MIGRATIONS[reverseKey];
    }
    if (!migration) {
      console.error("Error: No migration rules found for v" + opts.from + " -> v" + opts.to + (opts.reverse ? " (reverse)" : ""));
      console.error("Available migrations: " + Object.keys(MIGRATIONS).map(function(k) { return "v" + k.replace("-", " -> v"); }).join(", "));
      process.exit(1);
    }
  }

  if (opts.listRules) {
    console.log("Migration: " + migration.description);
    console.log("Rules (" + migration.rules.length + "):");
    for (var r = 0; r < migration.rules.length; r++) {
      var rule = migration.rules[r];
      console.log("  " + (r + 1) + ". [" + rule.type + "] " + rule.description);
    }
    process.exit(0);
  }

  if (opts.files.length === 0) {
    console.error("Error: No files specified");
    printUsage();
    process.exit(1);
  }

  // Find all matching files
  var files = findFiles(opts.files);

  if (files.length === 0) {
    console.error("Error: No HTML files found matching the given patterns");
    process.exit(1);
  }

  console.log("xhtmlx-migrate: v" + opts.from + " -> v" + opts.to + (opts.reverse ? " (reverse)" : "") + (opts.dryRun ? " [DRY RUN]" : ""));
  console.log("Processing " + files.length + " file(s)...");
  console.log("");

  var totalChanged = 0;
  var totalChanges = 0;

  for (var f = 0; f < files.length; f++) {
    var result = migrateFile(files[f], migration.rules, opts.dryRun);
    if (result.changed) {
      totalChanged++;
      totalChanges += result.changes.length;
      console.log("  " + (opts.dryRun ? "[would change]" : "[changed]") + " " + result.file);
      for (var c = 0; c < result.changes.length; c++) {
        console.log("    - " + result.changes[c]);
      }
    }
  }

  console.log("");
  console.log("Summary:");
  console.log("  Files scanned:  " + files.length);
  console.log("  Files changed:  " + totalChanged);
  console.log("  Total changes:  " + totalChanges);

  if (opts.dryRun && totalChanged > 0) {
    console.log("");
    console.log("Run without --dry-run to apply changes.");
  }

  process.exit(totalChanged > 0 && opts.dryRun ? 0 : 0);
}

main();
