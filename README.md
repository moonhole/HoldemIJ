## holdem-lite

一个**可单独搬走**的德州扑克（Texas Hold'em）“档1：纯玩法引擎”最小实现：

- **不依赖 NSQ / DB / Hall**
- 只包含**发牌、下注轮、底池/边池、摊牌结算**等核心逻辑
- 对外提供同步 API，便于你后续在新仓库里接入直连 TCP/WS/HTTP 等 transport

### 目录结构

- `card/`: 扑克牌基础类型（`Card`/`CardList`）
- `holdem/`: 玩法引擎（`Game`）

### H5 客户端方案文档

见 `H5_SOLUTION.md`。

### 快速使用（示例）

```go
package main

import (
	"fmt"
	"log"

	"holdem-lite/holdem"
)

func main() {
	g, err := holdem.NewGame(holdem.Config{
		MaxPlayers: 6,
		MinPlayers: 2,
		SmallBlind: 50,
		BigBlind:   100,
		Ante:       0,
	})
	if err != nil {
		log.Fatal(err)
	}

	_ = g.SitDown(0, 10001, 10000, false)
	_ = g.SitDown(1, 10002, 10000, false)

	if err := g.StartHand(); err != nil {
		log.Fatal(err)
	}

	snap := g.Snapshot()
	acts, minRaiseTo, _ := g.LegalActions(snap.ActionChair)
	fmt.Println("action chair:", snap.ActionChair, "legal:", acts, "minRaiseTo:", minRaiseTo)
}
```