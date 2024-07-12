out/index.js: src/index.ts tsconfig.json
	tsc

fmt:
	tsfmt -r

run: out/index.js
	./run.sh
