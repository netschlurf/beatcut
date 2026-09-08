cmake_minimum_required(VERSION 3.16)
project(beatcut_native LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
add_executable(beatcut-native
  src/main.cpp
  src/audio.cpp
  src/image.cpp
)
target_include_directories(beatcut-native PRIVATE include)
if (UNIX)
  target_link_libraries(beatcut-native PRIVATE m)
endif()
