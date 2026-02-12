# Deployment and Cost Plan (Stateful Poker Backend)

This document is a practical deployment guide for the current backend architecture.

It answers:

1. Stateful game nodes vs moving live table state out of memory
2. Cloud provider selection
3. Rough monthly cost ranges

Date context: estimates prepared in Feb 2026.

---

## 1. Architecture Decision

### 1.1 Keep stateful game nodes

For this project, keep live table state in memory on the game node.

Reason:

- Poker table actions are strict-order and latency sensitive.
- In-memory table actors simplify turn order, timers, and WS fanout.
- Full externalization of live state increases complexity and failure modes early.

### 1.2 What to externalize now

- Auth/session persistence: PostgreSQL
- Audit/ledger persistence: PostgreSQL
- Routing directory and presence hints: Redis (small footprint)

### 1.3 What not to externalize yet

- Per-table authoritative runtime state (turn, pot transitions, action timers)

---

## 2. Provider Selection

## 2.1 Recommendation

Primary recommendation:

- AWS for production path with clearer long-term scaling and managed ecosystem.

Cost-sensitive alternative:

- DigitalOcean for faster and cheaper early stage rollout.

Not preferred for this architecture right now:

- Fly.io for production stateful table hosting (more custom routing/ops burden for this use case).

## 2.2 Selection matrix

- AWS:
  - Pros: mature networking, managed DB/cache, clear enterprise path
  - Cons: higher baseline cost, egress and NAT can surprise
- DigitalOcean:
  - Pros: simple pricing, lower baseline, fast setup
  - Cons: fewer advanced controls at scale than AWS
- Fly.io:
  - Pros: developer-friendly global edge model
  - Cons: less straightforward for strict stateful WS table ownership and failover model

---

## 3. Reference Topologies

### 3.1 Topology A (beta baseline)

- 2 game app nodes
- 1 load balancer
- 1 managed PostgreSQL (single primary)
- 1 managed Redis (single node)
- object storage and logs

### 3.2 Topology B (launch baseline)

- 3 to 4 game app nodes
- 1 load balancer
- managed PostgreSQL HA (multi-AZ or equivalent)
- Redis with replica/failover
- centralized logs/metrics/alerts

---

## 4. Cost Assumptions

All rough ranges assume:

- one region
- 730 hours per month
- modest early traffic
- no aggressive multi-region HA yet

Costs vary significantly by:

- egress traffic
- DB storage and IOPS
- NAT gateway usage patterns
- log retention and observability tooling

---

## 5. Rough Monthly Cost Ranges

## 5.1 DigitalOcean (cost-optimized path)

### MVP / internal alpha

- 1 app node (basic droplet)
- managed PostgreSQL single node
- managed Redis single node
- no LB (or minimal)

Expected range: USD 40 to 90 per month

### Public beta

- 2 app nodes + regional LB
- managed PostgreSQL single node
- managed Redis single node

Expected range: USD 90 to 180 per month

### Launch baseline (higher reliability)

- 3 app nodes + LB
- managed PostgreSQL with standby/read replica
- managed Redis with standby

Expected range: USD 180 to 420 per month

---

## 5.2 AWS (production-first path)

### MVP / internal alpha

- 1 app node
- ALB
- RDS PostgreSQL single-AZ
- ElastiCache single node

Expected range: USD 90 to 220 per month

### Public beta

- 2 app nodes
- ALB + moderate LCU usage
- RDS PostgreSQL single-AZ
- ElastiCache single node
- basic monitoring/logging

Expected range: USD 180 to 420 per month

### Launch baseline (higher reliability)

- 3 to 4 app nodes
- ALB
- RDS PostgreSQL multi-AZ
- ElastiCache primary + replica
- stronger monitoring and alerting

Expected range: USD 450 to 1200 per month

---

## 6. Biggest Cost Traps

1. NAT Gateway
- Can materially increase monthly bill under chatty outbound traffic.
- If possible, minimize NAT path and use VPC endpoints where practical.

2. Egress
- Outbound traffic is a first-order variable at scale.
- Budget with a traffic scenario model early.

3. Database HA over-provisioning too early
- Good to add reliability, but do not jump to heavy multi-node tiers before load requires it.

4. Log volume
- Unbounded debug logs can silently create meaningful monthly cost.

---

## 7. Suggested Rollout Sequence

1. Start with single-region stateful deployment.
2. Keep table authority in-memory and durable replay/audit in Postgres.
3. Add Redis only for routing metadata and presence hints.
4. Add HA tiers after real load and failure data, not before.

---

## 8. Practical Choice for This Project

If your top priority is speed plus lower spend:

- Start on DigitalOcean beta topology.

If your top priority is long-term production posture:

- Start on AWS beta topology.

In both cases:

- keep stateful game nodes
- keep external persistence for auth/ledger
- avoid full state externalization for now

---

## 9. Price References (official pages)

- AWS Elastic Load Balancing pricing:
  - https://aws.amazon.com/elasticloadbalancing/pricing/
- AWS EC2 on-demand pricing:
  - https://aws.amazon.com/ec2/pricing/on-demand/
- AWS RDS PostgreSQL pricing:
  - https://aws.amazon.com/rds/postgresql/pricing/
- AWS pricing calculator:
  - https://calculator.aws/
- DigitalOcean Droplet pricing:
  - https://www.digitalocean.com/pricing/droplets
- DigitalOcean Load Balancer pricing:
  - https://docs.digitalocean.com/products/networking/load-balancers/details/pricing/
- DigitalOcean PostgreSQL pricing:
  - https://docs.digitalocean.com/products/databases/postgresql/details/pricing/
- DigitalOcean Caching (Redis) pricing:
  - https://docs.digitalocean.com/products/databases/redis/details/pricing/

