# Use a marker file to stop GNU make from running `tsc` for each stale input
.PHONY: build
build: out/.build

# Actual build rule for all TypeScript inputs and JavaScript outputs
out/.build: src/*.ts tsconfig.json
	tsc --incremental
	@touch $@

out/%.js: out/.build
	@: Do nothing, built by out/.build rule above

# Format all source files (unconditionally)
fmt: .editorconfig
	tsfmt -r

# Run app, building as needed
run: out/.build
	@./run.sh
