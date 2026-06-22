#!/bin/sh
BASE_DIRECTORY="$(dirname "$(realpath $0)")"

CACHE_DIRECTORY="${BASE_DIRECTORY}/.m2"
mkdir -p "${CACHE_DIRECTORY}"

mavenRun() {
	docker run --rm -v "${CACHE_DIRECTORY}:/root/.m2" -v "${BASE_DIRECTORY}/java/${1}":/usr/src/project -w /usr/src/project maven:eclipse-temurin mvn clean install
}

# Server plugins
mavenRun limbo
mavenRun velocity

# Vanillacord
mavenRun helperJars/VanillaCord/Bridge
mavenRun helperJars/VanillaCord
