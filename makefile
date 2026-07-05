# Account AI for Tally — developer tasks.
# Run `make` or `make help` to list targets.

CODE := code
.DEFAULT_GOAL := help
.PHONY: help setup build binary binaries test typecheck embeds panel mcp clean

help: ## Show this help
	@echo "Account AI for Tally — available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2}'

setup: ## Install dependencies (npm ci)
	cd $(CODE) && npm ci

build: ## Compile TypeScript to code/dist (Node)
	cd $(CODE) && npm run build

binary: ## Build a single self-contained binary for this OS (needs Bun) -> code/dist-bin/account-ai-for-tally
	cd $(CODE) && npm run build:binary

binaries: ## Cross-compile binaries for Windows + macOS (needs Bun)
	cd $(CODE) && npm run build:binary:all

test: ## Run the test suite
	cd $(CODE) && npm test

typecheck: ## Type-check without emitting
	cd $(CODE) && npm run typecheck

embeds: ## Regenerate embedded report templates + sql.js wasm
	cd $(CODE) && npm run build:embeds

panel: build ## Run the local control panel (opens the setup web UI)
	node $(CODE)/dist/main.mjs

mcp: build ## Run the MCP server over stdio (the mode Claude launches)
	node $(CODE)/dist/main.mjs --mcp

clean: ## Remove build artifacts (dist, dist-bin, generated embeds)
	rm -rf $(CODE)/dist $(CODE)/dist-bin $(CODE)/src/generated
