

Inspired by: https://github.com/ConnectEverything/nats-whiteboard

Start NATS server
```
./nats-server -c ./nats-featuremap/nats.conf
```

Create stream
```
nats stream create featuremap --subjects='featuremap.*' --allow-rollup
```


Start web app:
```
npm install
npm start
```
