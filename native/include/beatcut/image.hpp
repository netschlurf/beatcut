#pragma once
#include <string>

namespace beatcut {

struct VisualFeatures {
    double brightness = 0;
    double contrast = 0;
    double saturation = 0;
    double warmth = 0;
    double sharpness = 0;
    double energy = 0;
};

VisualFeatures analyze_image_file(const std::string& path);
VisualFeatures analyze_rgb(const unsigned char* rgb, int w, int h);

}  // namespace beatcut
