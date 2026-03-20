install:
	cd code && npm ci

build:
	cd code && npm run build
	rm -rf dist pull
	cp -r code/dist dist
	cp -r code/pull pull

typecheck:
	cd code && npm run typecheck

clean:
	rm -rf dist code/dist
