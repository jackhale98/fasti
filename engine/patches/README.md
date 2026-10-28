# engine/patches

Changes Fasti needs to make to Remind's C source to build it with Emscripten,
applied in name order by `engine/build.sh` (`patch -p1`). Empty unless
unavoidable: configure flags and Emscripten stubs come first.

Each patch starts with a comment saying what it changes and why. These patches
stay in this repository and are never sent upstream (docs/PLAN.md section 2).
