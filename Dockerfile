FROM oven/bun:latest

WORKDIR /app

# Install Docker and Docker Compose plugin
RUN apt update && apt install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

RUN mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

RUN echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
    $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null

RUN apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin


COPY package.json bun.lock ./

RUN bun install

COPY . .

EXPOSE 4587

CMD ["bun", "run", "index.ts"]
