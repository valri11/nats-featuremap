

Inspired by: https://github.com/ConnectEverything/nats-whiteboard

Start NATS server
```
./nats-server -c ./nats-featuremap/nats.conf
```

Create stream
```
nats stream create fewaturemap --subjects='featuremap.*' --allow-rollup
```

