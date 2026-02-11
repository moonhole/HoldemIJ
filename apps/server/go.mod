module holdem-lite/apps/server

go 1.23.0

require (
	github.com/gorilla/websocket v1.5.3
	google.golang.org/protobuf v1.36.4
	holdem-lite v0.0.0
)

require golang.org/x/crypto v0.36.0

replace holdem-lite => ../..
