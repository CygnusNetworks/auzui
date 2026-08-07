// Interner Docker-Build auf jenkins.cygnusnet.de, parallel zum
// GitHub-Actions-Build. Fuehrend bleibt GitHub; nach git.cygnusnet.de:auzui
// wird von Hand gepusht, der gitolite-post-receive stoesst diesen Job an.
//
// Ergebnis: hub.cygnusnet.de/auzui:<branch-latest|latest> und :<tag|rev>,
// auf einem Git-Tag zusaetzlich :stable. arm64 wird mitgebaut, weil
// docker-zabbix.cygnusnet.de arm64 ist.
@Library("jenkins-pipelines") _

pipeline {
    agent {
      label 'docker-jenkins'
    }

    stages {
        stage('Checkout SCM') {
            steps {
                script {
                    checkout scm
                }
            }
        }
        stage('Build') {
            steps {
                script {
                    // Ohne diese Args baut das Dockerfile ein Image mit leerer
                    // Version und unvollstaendigen OCI-Labels -- die
                    // Versionsanzeige im Frontend und der Update-Check haengen
                    // daran. GIT_VERSION/GIT_TAG_OR_REV setzt dockerBuild
                    // selbst in gitParse(), das laeuft aber erst in
                    // buildAndPush; hier wird deshalb direkt beschrieben, was
                    // das Dockerfile braucht.
                    def describe = sh(
                        returnStdout: true,
                        script: 'git -C source describe --tags --always --first-parent',
                    ).trim() - ~/^v/
                    def sha = sh(returnStdout: true, script: 'git -C source rev-parse HEAD').trim()
                    def buildTime = sh(returnStdout: true, script: 'date -u +%Y-%m-%dT%H:%M:%SZ').trim()

                    dockerBuild.buildAndPush(["linux/amd64", "linux/arm64"], 'source', [
                        VITE_APP_VERSION: describe,
                        AUZUI_VERSION: describe,
                        AUZUI_GIT_SHA: sha,
                        AUZUI_BUILD_TIME: buildTime,
                        // Jenkins-only: sidesteps the QEMU/gcc SIGSEGV when
                        // compiling python-gssapi for arm64, see Dockerfile.
                        // GitHub Actions never sets this build-arg, so its
                        // build is unaffected.
                        GSSAPI_ARM64_WHEEL_URL: 'https://pypi.cygnusnet.de/packages/gssapi-1.11.1-cp311-abi3-linux_aarch64.whl',
                    ])
                }
            }
        }
    }
}
