install:
	cd code && npm ci

build:
	cd code && npm run build
	rm -rf dist
	cp -r code/dist dist

typecheck:
	cd code && npm run typecheck

clean:
	rm -rf dist code/dist
