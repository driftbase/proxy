# Caddy Proxy

A proxy that allows your users to add custom domains.

### Setup cname record

Simply add an A record => "cname.mydomain.com" => ipv4

Then users can add an CNAME record => "test.mysite.com" => CNAME: cname.mydomain.com and BOOM!

Also you can turn cloudflare proxy on so you dont expose your proxy ip and for DDOS protection!

### Backup Caddyfile to S3
