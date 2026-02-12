module holdem-lite

go 1.23.0

require holdem-lite/apps/server v0.0.0

require google.golang.org/protobuf v1.36.4 // indirect

replace holdem-lite/apps/server => ./apps/server
