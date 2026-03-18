.PHONY: help install check lint lint-fix test test-unit test-integration test-browser \
       test-all test-watch test-coverage build minify size pack examples clean \
       ci ci-lint ci-test ci-browser ci-build ci-publish \
       playwright-install

# Default target
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

install: ## Install all dependencies
	npm ci

playwright-install: ## Install Playwright browsers
	npx playwright install chromium

# ---------------------------------------------------------------------------
# Checks
# ---------------------------------------------------------------------------

check: ## Check JS syntax validity
	@node --check xhtmlx.js
	@echo "Syntax OK"

lint: ## Run ESLint on library and tests
	npx eslint xhtmlx.js tests/ --ext .js

lint-fix: ## Run ESLint with auto-fix
	npx eslint xhtmlx.js tests/ --ext .js --fix

# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

test: test-unit ## Run unit tests (default)

test-unit: ## Run unit tests (jest)
	npx jest tests/unit --verbose --forceExit

test-integration: ## Run integration tests (jest)
	npx jest tests/integration --verbose --forceExit

test-browser: ## Run browser tests (Playwright + Chromium)
	npx playwright test

test-all: ## Run all tests: unit + integration + browser
	npx jest --verbose --forceExit
	npx playwright test

test-watch: ## Run jest tests in watch mode
	npx jest --watch --verbose

test-coverage: ## Run jest tests with coverage report
	npx jest --coverage --verbose

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

minify: ## Create minified version with source map
	npx terser xhtmlx.js -o xhtmlx.min.js --compress --mangle \
		--source-map "filename='xhtmlx.min.js.map',url='xhtmlx.min.js.map'"

size: minify ## Show file sizes after minification
	@echo "Original:   $$(wc -c < xhtmlx.js) bytes"
	@echo "Minified:   $$(wc -c < xhtmlx.min.js) bytes ($$(gzip -c xhtmlx.min.js | wc -c) gzipped)"
	@echo "Source map:  $$(wc -c < xhtmlx.min.js.map) bytes"

pack: ## Dry-run npm pack to verify package contents
	npm pack --dry-run

build: check lint test-all minify ## Full local build: check + lint + all tests + minify
	@echo "Build passed"

# ---------------------------------------------------------------------------
# CI targets (mirrors GitHub Actions steps exactly)
# ---------------------------------------------------------------------------

ci-lint: install check lint ## CI: lint job (install, syntax check, eslint)
	@echo "ci-lint passed"

ci-test: install ## CI: test job (install, jest tests)
	npx jest --verbose

ci-test-coverage: install ## CI: test job with coverage (install, jest + coverage)
	npx jest --verbose
	npx jest --coverage

ci-browser: install playwright-install ## CI: browser test job (install, playwright)
	npx playwright test

ci-build: install minify size ## CI: build job (install, minify, check sizes)
	@echo "ci-build passed"

ci-publish: install check lint playwright-install ## CI: publish job (check, lint, test, build, pack)
	npx jest --verbose --forceExit
	npx playwright test
	$(MAKE) minify
	npm pack --dry-run
	@echo "ci-publish ready (run 'npm publish --provenance --access public' to publish)"

ci: ci-lint ci-test ci-browser ci-build ## Full CI pipeline (all jobs)
	@echo "CI passed"

# ---------------------------------------------------------------------------
# Examples & Playground
# ---------------------------------------------------------------------------

examples: ## Start example server on port 3000
	node examples/server.js

playground: ## Start test server for playground on port 3333
	node tests/browser/server.js

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean: ## Remove generated files and node_modules
	rm -rf node_modules coverage xhtmlx.min.js xhtmlx.min.js.map test-results playwright-report *.tgz
