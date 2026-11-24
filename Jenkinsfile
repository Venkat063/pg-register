pipeline {
    agent any

    options {
        timestamps()
        disableConcurrentBuilds()
    }

    environment {
        DOCKER_REPO = 'venkat063/pgrent'
        NEXUS_URL = 'http://127.0.0.1:8081/repository/pg-rent-raw'
        K8S_NAMESPACE = 'pg-rent'
    }

    stages {

        // STAGE 1: BUILD
        stage('1. Build Application') {
            steps {
                checkout scm

                sh '''
                    set -e

                    echo "Building PG Rent Frontend"

                    docker run --rm \
                      --user "$(id -u):$(id -g)" \
                      -e HOME=/tmp \
                      -v "$WORKSPACE:/workspace" \
                      -w /workspace/frontend \
                      node:24-alpine sh -c \
                      "npm ci --no-audit --no-fund || npm install --no-audit --no-fund; npm run build"

                    echo "Validating API"

                    docker run --rm \
                      -v "$WORKSPACE:/workspace" \
                      -w /workspace \
                      node:24-alpine \
                      node --check devops/api/server.js

                    echo "Build completed"
                '''

                archiveArtifacts artifacts: 'frontend/dist/**',
                                 fingerprint: true
            }
        }

        // STAGE 2: NEXUS ARTIFACT BACKUP
        stage('2. Nexus Artifact Backup') {
            steps {
                sh '''
                    set -e

                    mkdir -p artifacts

                    tar -czf artifacts/pg-rent-${BUILD_NUMBER}.tar.gz \
                      frontend/dist \
                      devops/api/server.js \
                      devops/api/package.json \
                      devops/api/Dockerfile \
                      devops/web/Dockerfile \
                      devops/web/nginx.conf
                '''

                withCredentials([
                    usernamePassword(
                        credentialsId: 'nexus-creds',
                        usernameVariable: 'NEXUS_USER',
                        passwordVariable: 'NEXUS_PASSWORD'
                    )
                ]) {
                    sh '''
                        set -e

                        ARCHIVE="pg-rent-${BUILD_NUMBER}.tar.gz"

                        curl --fail --show-error \
                          --user "$NEXUS_USER:$NEXUS_PASSWORD" \
                          --upload-file "artifacts/$ARCHIVE" \
                          "$NEXUS_URL/$BUILD_NUMBER/$ARCHIVE"

                        echo "Artifact uploaded to Nexus"
                    '''
                }
            }
        }

        // STAGE 3: SONARQUBE + QUALITY GATE
        stage('3. SonarQube Code Quality') {
            steps {
                script {
                    def scannerHome = tool 'SonarScanner'

                    withSonarQubeEnv('SonarQube') {
                        sh """
                            ${scannerHome}/bin/sonar-scanner \
                              -Dsonar.projectKey=pg-rent \
                              -Dsonar.sources=frontend,devops/api \
                              -Dsonar.exclusions=**/node_modules/**,**/dist/** \
                              -Dsonar.token=\$SONAR_AUTH_TOKEN
                        """
                    }

                    timeout(time: 5, unit: 'MINUTES') {
                        waitForQualityGate abortPipeline: true
                    }
                }
            }
        }

        // STAGE 4: DOCKER BUILD AND PUSH
        stage('4. Docker Build and Push') {
            steps {
                script {
                    env.API_IMAGE = "${env.DOCKER_REPO}:api-${env.BUILD_NUMBER}"
                    env.WEB_IMAGE = "${env.DOCKER_REPO}:web-${env.BUILD_NUMBER}"

                    sh """
                        docker build \
                          -f devops/api/Dockerfile \
                          -t ${env.API_IMAGE} .

                        docker build \
                          -f devops/web/Dockerfile \
                          -t ${env.WEB_IMAGE} .
                    """

                    withCredentials([
                        usernamePassword(
                            credentialsId: 'dockerhub-creds',
                            usernameVariable: 'DOCKER_USER',
                            passwordVariable: 'DOCKER_PASS'
                        )
                    ]) {
                        sh '''
                            set -e

                            echo "$DOCKER_PASS" | docker login \
                              -u "$DOCKER_USER" --password-stdin

                            docker push "$API_IMAGE"
                            docker push "$WEB_IMAGE"

                            docker logout
                        '''
                    }
                }
            }
        }

        // STAGE 5: KUBERNETES DEPLOYMENT
        stage('5. Kubernetes Deployment') {
            steps {
                sh '''
                    set -e

                    echo "Preparing Kubernetes manifests"

                    mkdir -p .rendered

                    sed \
                      -e "s|__API_IMAGE__|$API_IMAGE|g" \
                      -e "s|__WEB_IMAGE__|$WEB_IMAGE|g" \
                      devops/k8s/jenkins/app.yaml \
                      > .rendered/app.yaml

                    kubectl apply \
                      -f devops/k8s/jenkins/namespace.yaml

                    kubectl apply \
                      -f .rendered/app.yaml

                    echo "Waiting for API deployment"

                    kubectl rollout status \
                      deployment/pg-rent-api \
                      -n "$K8S_NAMESPACE" \
                      --timeout=180s

                    echo "Waiting for Web deployment"

                    kubectl rollout status \
                      deployment/pg-rent-web \
                      -n "$K8S_NAMESPACE" \
                      --timeout=180s

                    echo "Kubernetes deployment completed"

                    kubectl get pods -n "$K8S_NAMESPACE"

                    kubectl get services -n "$K8S_NAMESPACE"
                '''
            }
        }
    }

    post {
        success {
            echo 'PG Rent CI/CD Pipeline Completed Successfully!'
        }

        failure {
            echo 'PG Rent CI/CD Pipeline Failed. Check the failed stage logs.'
        }

        always {
            echo "Build Number: ${BUILD_NUMBER}"
        }
    }
}
