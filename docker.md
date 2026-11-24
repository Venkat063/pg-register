# PG Rent Register — Docker, Kubernetes, Jenkins & AWS

A step-by-step path from "runs on my laptop" to "built by Jenkins, stored in Amazon ECR, running on Amazon EKS".
Work through the stages **in order** — each one proves the previous one works, and the first two are free.

---

## 0. Read this first

### What you are building

```
 You ──git push──▶ GitHub ──poll──▶ Jenkins (EC2)
                                       │ 1. docker build (api + web)
                                       │ 2. smoke test the API container
                                       │ 3. push images ─────────▶ Amazon ECR
                                       │ 4. kubectl apply ───────▶ Amazon EKS
                                                                      │
   Browser ──▶ AWS Load Balancer ──▶ web pods (nginx) ──/api──▶ api pods (Express) ──▶ Turso DB
                                     serves React app           stateless, 2 replicas   (hosted, unchanged)
```

- The **API image runs the same code as your Vercel deployment** (`frontend/api/_lib`) — there is one source of truth.
- The **database stays on Turso**, so pods hold no data: they can be killed, rescheduled and scaled freely.
- **nginx** serves the React build and forwards `/api` to the API, so the browser talks to a single address (same-origin, no CORS — same idea as on Vercel).
- Your **Vercel deployment keeps working untouched.** This is an additional way to run the same app.

### ⚠️ Cost warning (important)

| Stage | Cost |
|---|---|
| 1. Docker on your PC | Free |
| 2. Kubernetes on your PC (kind) | Free |
| 4. ECR image storage | Pennies |
| 5. **EKS cluster** | **≈ $0.10/hour for the control plane alone** (about $73/month), *plus* 2 servers, a NAT gateway and a load balancer |
| 6. Jenkins EC2 (t3.medium) | ≈ $0.045/hour while running |

Everything running together costs roughly **$0.25–0.30 per hour** (check the AWS pricing page for `ap-south-1`).
An evening of practice ≈ **$1–2**. **Left running for a month ≈ $180+.**

- Do Stages 1–2 first; they teach 80% of it for free.
- Do the AWS stages in **one sitting** and run **Stage 8 (Clean up) the same day.**
- Create a **budget alert** before you start (Stage 3).
- New AWS accounts get a credit-based free plan (up to ~$200 for ~6 months). Some services are restricted on the free plan — if EKS creation is refused, that is why; you would need to upgrade the account to the paid plan (remaining credits still apply).

### What has and hasn't been tested

Checked before you got these files: the API container's code path (boots, logs in, rejects bad requests without crashing, shuts down gracefully on SIGTERM); the nginx config with a real nginx in front of the real API (page, SPA fallback, `/api` proxy, caching and security headers, body-size limit); the Kubernetes manifests against the official schemas; both Dockerfiles with a linter; the Jenkinsfile's Groovy syntax and every shell block in it; and the pipeline's smoke-test script, including its failure path.

**Not** tested, because it needs real Docker/AWS: the actual image builds, a running cluster, a Jenkins server and an ECR push. Expect the odd snag; see the troubleshooting table at the end.

### Where the new files go

Everything is **new** — nothing in `frontend/` changes. Put these at the **root of your GitHub repo** (the folder that contains `frontend/` and `backend/`):

```
pg-register/                      ← repo root
├── Jenkinsfile
├── docker-compose.yml
├── .dockerignore
├── .env.example
├── .gitattributes
├── devops/
│   ├── DEVOPS_GUIDE.md           ← this file
│   ├── api/    Dockerfile, package.json, server.js
│   ├── web/    Dockerfile, nginx.conf
│   └── k8s/    00-namespace.yaml, 10-api.yaml, 20-web.yaml
├── frontend/                     (unchanged)
└── backend/                      (old standalone server; Docker no longer uses it — safe to delete)
```

Also add this line to your `.gitignore`:  `.rendered/`

```bash
git add .
git commit -m "Add Docker, Kubernetes and Jenkins pipeline"
git push
```

> **Windows tips:** use **Git Bash** (installed with Git for Windows) or WSL for the commands below — they are bash. Docker Desktop needs WSL 2 enabled. `.gitattributes` keeps the Jenkinsfile on Unix line endings; Windows-style endings break shell steps with errors like `set: Illegal option -`.

---

## Stage 1 — Docker on your own machine (free)

**Goal:** run the whole app in containers locally.

1. Install **Docker Desktop** and start it. Check: `docker --version`
2. From the repo root:
   ```bash
   docker compose up --build
   ```
   The first build takes a few minutes (it compiles the React app and installs the API's dependencies).
3. Open **http://localhost:8080** and sign in with `admin` / `admin123` (a fresh throw-away local database is created and seeded; change the password).

**What just happened:** two containers started — `api` (Express) and `web` (nginx). `web` waited for `api` to report healthy, then started serving the React app and proxying `/api` to it.

Useful commands:
```bash
docker compose ps                 # api should say "healthy"
docker compose logs -f api        # live API logs
docker compose down               # stop (keeps the local DB volume)
docker compose down -v            # stop and wipe the local DB
```

**Use your real Turso data instead:** copy `.env.example` to `.env`, fill in `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` (the same values you set in Vercel), then `docker compose up --build`.

**You should be able to explain:** multi-stage builds (the web image ships only nginx + static files, not Node); layer caching (dependencies are copied before code); why the container runs as a non-root user; what a HEALTHCHECK is for.

---

## Stage 2 — Kubernetes on your own machine with kind (free)

**Goal:** run the exact manifests you'll later deploy to AWS, locally.

1. Stop Docker Compose (`docker compose down`) — it uses the same port.
2. Install **kind** and **kubectl** (`winget install Kubernetes.kubectl` and `winget install Kubernetes.kind`, or see their docs).
3. Build the images and load them into a local cluster:
   ```bash
   docker build -f devops/api/Dockerfile -t local/pg-rent/api:dev .
   docker build -f devops/web/Dockerfile -t local/pg-rent/web:dev .

   kind create cluster --name pg-rent
   kind load docker-image local/pg-rent/api:dev local/pg-rent/web:dev --name pg-rent
   ```
4. Fill in the image placeholders (`__REGISTRY__`, `__TAG__`) — Jenkins does exactly this later:
   ```bash
   mkdir -p .rendered
   for f in devops/k8s/*.yaml; do
     sed -e "s|__REGISTRY__|local|g" -e "s|__TAG__|dev|g" "$f" > ".rendered/$(basename "$f")"
   done
   ```
5. Create the namespace and the secret that holds your credentials:
   ```bash
   kubectl apply -f .rendered/00-namespace.yaml
   kubectl -n pg-rent create secret generic pg-rent-secrets \
     --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
     --from-literal=TURSO_DATABASE_URL="libsql://YOUR-DB.turso.io" \
     --from-literal=TURSO_AUTH_TOKEN="YOUR-TURSO-TOKEN" \
     --from-literal=VIEWER_PASSWORD="choose-a-viewer-password"
   ```
   Use your **real Turso** values here. With a local file database, each of the 2 API pods would get its *own* separate database.
6. Deploy and watch:
   ```bash
   kubectl apply -f .rendered/
   kubectl -n pg-rent get pods -w          # wait until all 4 are Running and READY 1/1
   kubectl -n pg-rent port-forward svc/web 8080:80
   ```
   Open **http://localhost:8080**. (On kind the Service's external address stays `<pending>`; port-forward is how you reach it.)

**Exercises worth doing** — they are what interviewers ask about:
```bash
kubectl -n pg-rent delete pod -l component=api    # watch it self-heal
kubectl -n pg-rent scale deployment/api --replicas=3
kubectl -n pg-rent logs deploy/api
kubectl -n pg-rent describe pod <pod-name>
# Break it on purpose, then fix it:
kubectl -n pg-rent set image deployment/api api=local/pg-rent/api:nope   # ImagePullBackOff
kubectl -n pg-rent rollout undo deployment/api                           # back to the good version
```

Clean up: `kind delete cluster --name pg-rent`

---

## Stage 3 — AWS account set-up (once)

1. Create/sign in to your AWS account. **Turn on MFA for the root user** and don't use root for daily work.
2. **Budget alert first:** Billing → *Budgets* → *Create budget* → cost budget of **$10** with an email alert at 80%.
3. In IAM, create a user for yourself with `AdministratorAccess` (fine for a short learning session), create an access key for the CLI.
4. Install the **AWS CLI v2** and **eksctl** (and kubectl from Stage 2), then:
   ```bash
   aws configure          # paste the key, set region ap-south-1, output json
   aws sts get-caller-identity
   ```
   Note the 12-digit **Account ID** it prints — you need it for the Jenkinsfile.

---

## Stage 4 — Amazon ECR: your private image registry

```bash
export AWS_REGION=ap-south-1
aws ecr create-repository --repository-name pg-rent/api --region $AWS_REGION --image-scanning-configuration scanOnPush=true
aws ecr create-repository --repository-name pg-rent/web --region $AWS_REGION --image-scanning-configuration scanOnPush=true
```

Keep only the 10 newest images in each repo (storage stays at pennies):
```bash
for r in api web; do
  aws ecr put-lifecycle-policy --region $AWS_REGION --repository-name pg-rent/$r --lifecycle-policy-text \
   '{"rules":[{"rulePriority":1,"description":"keep last 10","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}'
done
```

Prove it works by pushing once by hand:
```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REG=$ACCOUNT.dkr.ecr.$AWS_REGION.amazonaws.com
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REG
docker build -f devops/api/Dockerfile -t $REG/pg-rent/api:manual .
docker push $REG/pg-rent/api:manual
```
Check the image appears in the console (ECR → Repositories → pg-rent/api).

---

## Stage 5 — Amazon EKS: the Kubernetes cluster

💸 The meter starts running here. Plan to finish Stage 5–7 in one sitting.

1. **Create the cluster** (takes ~15–20 minutes):
   ```bash
   eksctl create cluster \
     --name pg-rent --region ap-south-1 \
     --managed --nodegroup-name workers \
     --node-type t3.small --nodes 2 --nodes-min 2 --nodes-max 3
   ```
   Use a current `eksctl` so it picks a current Kubernetes version, then confirm in the EKS console that the cluster shows **Standard support** — old versions in *Extended support* cost about six times more for the control plane.
2. Check: `kubectl get nodes` (2 nodes, `Ready`).
3. **Namespace and secret** (same as Stage 2, but now against EKS):
   ```bash
   kubectl apply -f devops/k8s/00-namespace.yaml
   kubectl -n pg-rent create secret generic pg-rent-secrets \
     --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
     --from-literal=TURSO_DATABASE_URL="libsql://YOUR-DB.turso.io" \
     --from-literal=TURSO_AUTH_TOKEN="YOUR-TURSO-TOKEN" \
     --from-literal=VIEWER_PASSWORD="choose-a-viewer-password"
   ```
   Secrets live in the cluster, never in Git. (The worker nodes can already pull from your ECR — eksctl grants that.)
4. Stage 6 will deploy automatically. If you want to see the cluster work **before** Jenkins exists, push the `web` image like in Stage 4, render the manifests with your ECR address and tag `manual` (as in Stage 2 step 4), and `kubectl apply -f .rendered/`.
5. Find the public address once deployed:
   ```bash
   kubectl -n pg-rent get svc web
   ```
   The `EXTERNAL-IP` column shows a long `…elb.ap-south-1.amazonaws.com` name. It can take a few minutes before it resolves. Open `http://<that-name>`.

---

## Stage 6 — Jenkins on EC2: the CI/CD pipeline

### 6.1 Give Jenkins permission without storing keys (IAM role)

1. **IAM → Policies → Create policy → JSON.** Replace `ACCOUNT_ID`, name it `jenkins-pg-rent`:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Effect": "Allow", "Action": ["ecr:GetAuthorizationToken"], "Resource": "*" },
       { "Effect": "Allow",
         "Action": ["ecr:BatchCheckLayerAvailability","ecr:InitiateLayerUpload","ecr:UploadLayerPart",
                    "ecr:CompleteLayerUpload","ecr:PutImage","ecr:BatchGetImage","ecr:GetDownloadUrlForLayer"],
         "Resource": "arn:aws:ecr:ap-south-1:ACCOUNT_ID:repository/pg-rent/*" },
       { "Effect": "Allow", "Action": ["eks:DescribeCluster"],
         "Resource": "arn:aws:eks:ap-south-1:ACCOUNT_ID:cluster/pg-rent" }
     ]
   }
   ```
2. **IAM → Roles → Create role →** trusted entity *AWS service → EC2* → attach `jenkins-pg-rent` → name it `jenkins-ec2-role`.

### 6.2 Launch the server

EC2 → *Launch instance*: **Ubuntu 24.04**, **t3.medium** (builds need the memory), 20 GB disk, a key pair, **IAM instance profile = `jenkins-ec2-role`**, and a security group allowing **SSH (22)** and **TCP 8080** from **My IP only**.

### 6.3 Install everything (SSH in)

```bash
sudo apt-get update
sudo apt-get install -y fontconfig openjdk-21-jre docker.io unzip curl

# Jenkins (signing key valid for 2026 — see jenkins.io/doc/book/installing/linux if this ever fails)
sudo mkdir -p /etc/apt/keyrings
sudo wget -O /etc/apt/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2026.key
echo "deb [signed-by=/etc/apt/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
sudo apt-get update && sudo apt-get install -y jenkins

# AWS CLI v2
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscliv2.zip && unzip -q awscliv2.zip && sudo ./aws/install

# kubectl
curl -fsSLo kubectl "https://dl.k8s.io/release/$(curl -fsSL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -m 0755 kubectl /usr/local/bin/kubectl

# let Jenkins use Docker
sudo usermod -aG docker jenkins
sudo systemctl restart jenkins
```
Verify as the Jenkins user:
```bash
sudo -u jenkins docker ps
sudo -u jenkins aws sts get-caller-identity     # should show the assumed role jenkins-ec2-role
kubectl version --client
```

### 6.4 Let Jenkins talk to the cluster

Run from **your own computer** (where you created the cluster):
```bash
ROLE_ARN=$(aws iam get-role --role-name jenkins-ec2-role --query Role.Arn --output text)
aws eks create-access-entry --cluster-name pg-rent --region ap-south-1 --principal-arn $ROLE_ARN
aws eks associate-access-policy --cluster-name pg-rent --region ap-south-1 --principal-arn $ROLE_ARN \
  --policy-arn arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy \
  --access-scope type=cluster
```
(If this says the cluster doesn't support access entries, use instead:
`eksctl create iamidentitymapping --cluster pg-rent --region ap-south-1 --arn $ROLE_ARN --group system:masters --username jenkins`.)
Cluster-admin is the simple choice for a lab; in a real team you'd scope it to the `pg-rent` namespace.

### 6.5 Set up Jenkins

1. Open `http://<EC2-public-IP>:8080`. Unlock with `sudo cat /var/lib/jenkins/secrets/initialAdminPassword`, choose **Install suggested plugins**, create your admin user.
2. **Edit the four values at the top of the `Jenkinsfile`** (`AWS_ACCOUNT`, `AWS_REGION`, `EKS_CLUSTER`, `K8S_NAMESPACE`), commit and push.
3. **New Item → name `pg-rent` → Pipeline → OK.** Under *Pipeline*: Definition **Pipeline script from SCM** → SCM **Git** → Repository URL `https://github.com/mothukuri-v/pg-register.git` → Branch `*/main` → Script Path `Jenkinsfile` → Save. (For a private repo, add GitHub credentials — a personal access token — and select them.)
4. Click **Build Now** and open the build's **Console Output**.

### 6.6 What the pipeline does

| Stage | What happens | What it protects you from |
|---|---|---|
| Checkout | Gets the code, tags images with the git commit | Not knowing which code is running |
| Build images | Builds API + web images (this also compiles the React app) | A frontend compile error |
| Smoke test | Starts the new API container and waits for `/api/health` | Shipping an image that can't boot |
| Push to ECR | Pushes `:<commit>` and `:latest` (main branch only) | — |
| Deploy to EKS | Fills in image names, `kubectl apply`, waits for the rollout | — |
| *(on failure)* | `kubectl rollout undo` for both deployments | A bad release staying live |

After the first successful run, Jenkins checks GitHub every ~5 minutes: **push a change and watch it deploy itself.**

---

## Stage 7 — Verify, and a demo you can show

```bash
kubectl -n pg-rent get pods -o wide
kubectl -n pg-rent get svc web
kubectl -n pg-rent rollout history deployment/api
```
- Open the load-balancer address, sign in, check the `viewer` account hides phone numbers.
- **Self-healing:** `kubectl -n pg-rent delete pod -l component=api` — the site keeps working.
- **Zero-downtime deploy:** change some text in the UI, push, and refresh while Jenkins deploys (`maxUnavailable: 0` keeps old pods until new ones are ready).
- **Automatic rollback:** push a change that breaks `/api/health`; the rollout never becomes ready, the stage fails, and Jenkins runs `rollout undo`.

---

## Stage 8 — CLEAN UP (do this the same day)

Order matters, so AWS can remove what Kubernetes created:

```bash
# 1. Remove the load balancer first
kubectl -n pg-rent delete svc web

# 2. Delete the cluster, its servers, NAT gateway and VPC (10–15 min)
eksctl delete cluster --name pg-rent --region ap-south-1

# 3. Delete the images
aws ecr delete-repository --repository-name pg-rent/api --region ap-south-1 --force
aws ecr delete-repository --repository-name pg-rent/web --region ap-south-1 --force
```
4. **Terminate** the Jenkins EC2 instance (stopping it still bills for its disk).
5. In the console, confirm these are all empty in `ap-south-1`: EC2 → *Load Balancers*, *Volumes*, *Elastic IPs*; VPC → *NAT Gateways*; CloudFormation → no `eksctl-pg-rent-*` stacks.
6. Check **Billing → Cost Explorer** the next day.

---

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| Pod `ImagePullBackOff` | Wrong image name/tag (check `AWS_ACCOUNT` / `AWS_REGION` in the Jenkinsfile) or the image wasn't pushed. `kubectl -n pg-rent describe pod <name>` shows the exact error. |
| Pod `CreateContainerConfigError` | The `pg-rent-secrets` secret or one of its keys is missing — redo the `kubectl create secret` step. |
| API pod `CrashLoopBackOff` | `kubectl -n pg-rent logs <pod>` — usually a wrong Turso URL/token. |
| Pods stuck `Pending` | Not enough room on the nodes (t3.small allows ~11 pods each). Add a node: `eksctl scale nodegroup --cluster pg-rent --name workers --nodes 3 --region ap-south-1`. |
| `EXTERNAL-IP` stays `<pending>` | Wait 3–5 minutes, then `kubectl -n pg-rent describe svc web` and read the events. |
| Page loads, login says **502/504** | API pods aren't ready: `kubectl -n pg-rent get pods`. |
| web pod restarts, log says `host not found in upstream "api"` | The `api` Service wasn't created yet or is in another namespace. It retries by itself; `kubectl -n pg-rent get svc`. |
| Jenkins: `permission denied … docker.sock` | The `jenkins` user isn't in the `docker` group, or Jenkins wasn't restarted after adding it. |
| Jenkins: `Unable to locate credentials` | The IAM role isn't attached: EC2 → instance → Actions → Security → *Modify IAM role*. |
| `kubectl` says `You must be logged in … (Unauthorized)` | Step 6.4 wasn't done (or used the wrong role ARN). |
| `exec format error` in a pod | Image built for the wrong CPU (e.g. on an Apple-silicon Mac or an ARM server). Build with `--platform linux/amd64`. |
| `set: Illegal option -` in a Jenkins shell step | Windows line endings in the Jenkinsfile. Make sure `.gitattributes` was committed, then re-save the file with LF endings. |
| Smoke test fails | The stage prints the container's logs just above the failure — read them. |

---

## Where to go next

- **HTTPS and a real domain:** Route 53 + an ACM certificate + the AWS Load Balancer Controller (Ingress).
- **Infrastructure as code:** rebuild Stage 3–5 with **Terraform** so the whole environment is one command up, one command down.
- **Autoscaling:** metrics-server + a HorizontalPodAutoscaler.
- **Observability:** Prometheus + Grafana, or CloudWatch Container Insights.
- **Security in the pipeline:** a Trivy image-scan stage; secrets via AWS Secrets Manager.
- **GitOps:** Argo CD instead of `kubectl apply` from Jenkins.
- **Tests:** add a unit/integration test stage before the build.

An honest note: for an app this size, Vercel + Turso is the simpler and cheaper way to run it. This setup is for **learning and demonstrating** how production systems are built and shipped — say so in an interview; it shows judgement.

---

## How to talk about it in an interview

**The 30-second version**
> "I containerised my rent-management app and built a CI/CD pipeline for it. Jenkins builds Docker images on every push, smoke-tests the API container, pushes tagged images to Amazon ECR, and deploys to a Kubernetes cluster on EKS with a rolling update and automatic rollback. The database is hosted, so the pods are stateless and can be rescheduled or scaled freely."

**Design decisions you can defend**
- **One codebase, two runtimes:** the API image runs the same `app.js` as the Vercel deployment — only a small `server.js` adds the listener.
- **nginx in front, same-origin:** the browser sees one address, so no CORS; the API isn't exposed to the internet at all (ClusterIP).
- **Stateless pods + external DB:** the reason scaling to 2 replicas and rolling updates are safe.
- **Rolling updates with `maxUnavailable: 0`, readiness and liveness probes:** old pods stay until new ones pass `/api/health`.
- **Graceful shutdown on SIGTERM:** in-flight requests finish during a deploy.
- **A real bug found while testing:** in a long-running container, one failing async request crashed the entire Express 4 process (it doesn't catch async errors). I reproduced the crash, added error forwarding, and confirmed the same request now returns a clean 500 and the server stays up.
- **Images tagged with the git commit:** every running pod is traceable to the exact code.
- **IAM instance role instead of stored access keys:** nothing long-lived to leak.
- **Secrets in Kubernetes Secrets, never in Git;** non-root containers; dropped Linux capabilities.
- **Cost awareness:** tore the cluster down the same day, with a budget alert set up first.

**Likely questions**
- *Why Kubernetes for this?* Honestly: it's more than the app needs. It's what I used to learn self-healing, rolling updates and scaling hands-on.
- *Why Jenkins over GitHub Actions?* It's still widely used in enterprises, and running it myself taught me agents, credentials and pipeline-as-code. Actions would be less to maintain.
- *What happens when a deploy fails?* The new pods never become ready, `rollout status` times out, the stage fails, and the pipeline runs `rollout undo` — users stay on the old version throughout.
- *How would you add HTTPS?* ACM certificate + an ALB Ingress via the AWS Load Balancer Controller, with the domain in Route 53.
- *What would you monitor?* Request rate, error rate, latency, pod restarts and CPU/memory, with alerts on error rate and restart loops.
