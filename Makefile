.PHONY: build test e2e run clean

build:
	go build -o planner .

test:
	go vet ./... && go test ./...

e2e: 
	cd e2e && (test -d node_modules || npm install) && npx playwright test

run: build
	./planner -addr 127.0.0.1:8080 -db dev.db

clean:
	rm -f planner dev.db dev.db-*
