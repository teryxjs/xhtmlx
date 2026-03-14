.PHONY: help install lint lint-fix test test-unit test-integration test-all \
       examples clean build check ci

# Default target
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------

install: ## Install dependencies
	npm install

# ---------------------------------------------------------------------------
# Linting
# ---------------------------------------------------------------------------

lint: ## Run linter (ESLint)
	npx eslint xhtmlx.js tests/ --ext .js

lint-fix: ## Run linter and auto-fix
	npx eslint xhtmlx.js tests/ --ext .js --fix

# ---------------------------------------------------------------------------
# Testing
# ---------------------------------------------------------------------------

test: test-unit ## Run unit tests (alias for test-unit)

test-unit: ## Run unit tests
	npx jest tests/unit --verbose

test-integration: ## Run integration tests
	npx jest tests/integration --verbose

test-all: ## Run all tests (unit + integration)
	npx jest --verbose

test-watch: ## Run tests in watch mode
	npx jest --watch --verbose

test-coverage: ## Run tests with coverage report
	npx jest --coverage --verbose

# ---------------------------------------------------------------------------
# Syntax check
# ---------------------------------------------------------------------------

check: ## Check JS syntax validity
	node --check xhtmlx.js
	@echo "Syntax OK"

# ---------------------------------------------------------------------------
# Examples
# ---------------------------------------------------------------------------

examples: ## Start example server on port 3000
	node examples/server.js

# ---------------------------------------------------------------------------
# Build / Release
# ---------------------------------------------------------------------------

build: check lint test-all ## Full build: syntax check + lint + all tests
	@echo "Build passed"

minify: ## Create minified version (requires terser)
	npx terser xhtmlx.js -o xhtmlx.min.js --compress --mangle
	@echo "Minified: xhtmlx.min.js ($$(wc -c < xhtmlx.min.js) bytes)"

# ---------------------------------------------------------------------------
# CI/CD
# ---------------------------------------------------------------------------

ci: install check lint test-all ## Full CI pipeline: install, check, lint, test
	@echo "CI passed"

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------

clean: ## Remove generated files and node_modules
	rm -rf node_modules coverage xhtmlx.min.js
