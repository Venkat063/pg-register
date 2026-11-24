// CI/CD pipeline: GitHub -> Docker build -> smoke test -> Amazon ECR -> Amazon EKS
//
// Runs on a Jenkins server (an EC2 instance) that has Docker, the AWS CLI and
// kubectl installed, and an IAM *instance role* allowing it to push to ECR and
// talk to EKS. No AWS keys are stored in Jenkins or in this file.
// Full setup steps: devops/DEVOPS_GUIDE.md

pipeline {
  agent any

  options {
    timestamps()
    disableConcurrentBuilds()
    timeout(time: 30, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '15'))
  }

  // Checks GitHub every ~5 minutes. (A webhook is faster but requires exposing
  // Jenkins to the internet, so polling is the safer default.)
  triggers { pollSCM('H/5 * * * *') }

  environment {
    // ---- EDIT THESE FOUR ----------------------------------------------------
    AWS_ACCOUNT   = '123456789012'   // your 12-digit AWS account id
    AWS_REGION    = 'ap-south-1'     // Mumbai
    EKS_CLUSTER   = 'pg-rent'
    K8S_NAMESPACE = 'pg-rent'
    // -------------------------------------------------------------------------
    REGISTRY  = "${AWS_ACCOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com"
    API_IMAGE = "${REGISTRY}/pg-rent/api"
    WEB_IMAGE = "${REGISTRY}/pg-rent/web"
  }

  stages {

    stage('Checkout') {
      steps {
        checkout scm
        script {
          // Tag images with the git commit, so every deploy is traceable to code.
          env.IMAGE_TAG = sh(script: 'git rev-parse --short=8 HEAD', returnStdout: true).trim()
          echo "Building commit ${env.IMAGE_TAG}"
        }
      }
    }

    // The web image build also compiles the React app, so a compile error
    // anywhere in the frontend fails the pipeline here.
    stage('Build images') {
      steps {
        sh '''
          docker build -f devops/api/Dockerfile -t $API_IMAGE:$IMAGE_TAG -t $API_IMAGE:latest .
          docker build -f devops/web/Dockerfile -t $WEB_IMAGE:$IMAGE_TAG -t $WEB_IMAGE:latest .
        '''
      }
    }

    // Start the freshly built API container and make sure it really boots and
    // answers its health check, before anything is pushed or deployed.
    stage('Smoke test') {
      steps {
        sh '''
          set -e
          cid=$(docker run -d --rm \
                  -e JWT_SECRET=ci-only \
                  -e TURSO_DATABASE_URL=file:/tmp/ci.db \
                  $API_IMAGE:$IMAGE_TAG)
          trap "docker stop $cid >/dev/null 2>&1 || true" EXIT

          for i in $(seq 1 20); do
            if docker exec $cid wget -qO- http://127.0.0.1:4000/api/health | grep -q '"ok":true'; then
              echo "API is healthy"
              exit 0
            fi
            sleep 2
          done

          echo "API did not become healthy in time"
          docker logs $cid
          exit 1
        '''
      }
    }

    // Only the main branch is published and deployed.
    stage('Push to ECR') {
      when { expression { return env.GIT_BRANCH in ['origin/main', 'main'] } }
      steps {
        sh '''
          aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $REGISTRY
          docker push $API_IMAGE:$IMAGE_TAG
          docker push $API_IMAGE:latest
          docker push $WEB_IMAGE:$IMAGE_TAG
          docker push $WEB_IMAGE:latest
        '''
      }
    }

    stage('Deploy to EKS') {
      when { expression { return env.GIT_BRANCH in ['origin/main', 'main'] } }
      steps {
        sh '''
          set -e
          aws eks update-kubeconfig --region $AWS_REGION --name $EKS_CLUSTER

          # Fill the __REGISTRY__ / __TAG__ placeholders in the manifests.
          rm -rf .rendered && mkdir .rendered
          for f in devops/k8s/*.yaml; do
            sed -e "s|__REGISTRY__|$REGISTRY|g" -e "s|__TAG__|$IMAGE_TAG|g" "$f" > ".rendered/$(basename "$f")"
          done

          kubectl apply -f .rendered/
          kubectl -n $K8S_NAMESPACE rollout status deployment/api --timeout=180s
          kubectl -n $K8S_NAMESPACE rollout status deployment/web --timeout=180s
          kubectl -n $K8S_NAMESPACE get pods,svc
        '''
      }
      post {
        // If the new version never becomes healthy, go back to the previous one.
        failure {
          sh '''
            kubectl -n $K8S_NAMESPACE rollout undo deployment/api || true
            kubectl -n $K8S_NAMESPACE rollout undo deployment/web || true
          '''
        }
      }
    }
  }

  post {
    success { echo "Deployed ${env.IMAGE_TAG} successfully." }
    failure { echo "Pipeline failed — check the stage logs above." }
    always {
      sh 'docker logout $REGISTRY || true'
      sh 'docker image prune -f || true'
      deleteDir()
    }
  }
}
