#include "beatcut/audio.hpp"
#include "beatcut/image.hpp"

#include <cstdio>
#include <cstdlib>
#include <iostream>
#include <string>

static int audio_cmd(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: beatcut-native audio <wav>\n";
        return 2;
    }
    auto a = beatcut::analyze_wav(argv[1]);
    std::printf("{\n");
    std::printf("  \"path\": \"%s\",\n", a.path.c_str());
    std::printf("  \"duration\": %.6f,\n", a.duration);
    std::printf("  \"sample_rate\": %d,\n", a.sample_rate);
    if (a.has_bpm)
        std::printf("  \"bpm_estimate\": %.4f,\n", a.bpm_estimate);
    else
        std::printf("  \"bpm_estimate\": null,\n");
    std::printf("  \"beat_count\": %zu,\n", a.beats.size());
    std::printf("  \"beats\": [\n");
    for (size_t i = 0; i < a.beats.size(); ++i) {
        const auto& b = a.beats[i];
        std::printf("    {\"t\": %.6f, \"index\": %d, \"energy\": %.4f, \"strength\": %.4f}%s\n",
                    b.t, b.index, b.energy, b.strength, i + 1 == a.beats.size() ? "" : ",");
    }
    std::printf("  ]\n}\n");
    return 0;
}

static int image_cmd(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: beatcut-native image <file>\n";
        return 2;
    }
    auto f = beatcut::analyze_image_file(argv[1]);
    std::printf(
        "{\"path\":\"%s\",\"brightness\":%.4f,\"contrast\":%.4f,\"saturation\":%.4f,"
        "\"warmth\":%.4f,\"sharpness\":%.4f,\"energy\":%.4f}\n",
        argv[1], f.brightness, f.contrast, f.saturation, f.warmth, f.sharpness, f.energy);
    return 0;
}

int main(int argc, char** argv) {
    if (argc < 2) {
        std::cerr << "usage: beatcut-native <audio|image> ...\n";
        return 2;
    }
    const std::string cmd = argv[1];
    try {
        if (cmd == "audio") return audio_cmd(argc - 1, argv + 1);
        if (cmd == "image") return image_cmd(argc - 1, argv + 1);
        std::cerr << "unknown command\n";
        return 2;
    } catch (const std::exception& e) {
        std::cerr << e.what() << "\n";
        return 1;
    }
}
