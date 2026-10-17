.PHONY: build test e2e run clean dist install

# Git description baked into the binary as the build id (see `planner -version`);
# the semantic version itself lives in main.go.
VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
LDFLAGS  = -X main.build=$(VERSION)

build:
	go build -ldflags "$(LDFLAGS)" -o planner .

test:
	go vet ./... && go test ./...

e2e: 
	cd e2e && (test -d node_modules || npm install) && npx playwright test

run: build
	./planner -addr 127.0.0.1:8080 -db dev.db

# Static linux/amd64 binary for deployment (the SQLite driver is pure Go, so
# no cgo is needed and the result runs on any x86-64 Linux, including Debian 13).
dist:
	mkdir -p dist
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags "-s -w $(LDFLAGS)" -o dist/planner .
	@echo "built dist/planner ($(VERSION))"

# Install as a systemd service on this machine (needs root). Builds the binary
# if Go is available; otherwise pass a prebuilt one: make install BIN=dist/planner
install:
	./deploy/install.sh $(BIN)

clean:
	rm -f planner dev.db dev.db-*
	rm -rf dist
