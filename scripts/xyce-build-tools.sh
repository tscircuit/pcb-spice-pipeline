#!/usr/bin/env bash
# User-space toolchain on a remote Linux machine: micromamba toolchain, ngspice 47, Trilinos 16.1 + Xyce (serial and MPI).
# No sudo. Everything lives under $R.
set -euo pipefail
R=${R:-$HOME/si-xyce-research}
J=${J:-$(nproc)}
mkdir -p "$R"/{bin,src,build,opt,logs}
cd "$R"
export MAMBA_ROOT_PREFIX=$R/mamba
if [ ! -x bin/micromamba ]; then
  curl -fsSL https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj -C bin --strip-components=1 bin/micromamba
fi
if [ ! -d env ]; then
  bin/micromamba create -y -p "$R/env" -c conda-forge \
    gcc=13 gxx=13 gfortran=13 cmake make bison flex fftw openblas liblapack libblas suitesparse openmpi=4 \
    pkg-config autoconf automake libtool readline bc time
fi
eval "$(bin/micromamba shell hook -s bash)"
micromamba activate "$R/env"
export CC=gcc CXX=g++ FC=gfortran

# ngspice 47 (same release as the Mac baseline), batch-only.
if [ ! -x opt/ngspice/bin/ngspice ]; then
  cd src; [ -d ngspice-47 ] || curl -fsSL https://downloads.sourceforge.net/project/ngspice/ng-spice-rework/47/ngspice-47.tar.gz | tar xz
  cd ngspice-47; ./configure --prefix="$R/opt/ngspice" --with-x=no --enable-openmp --disable-debug >"$R/logs/ngspice-configure.log" 2>&1
  make -j"$J" >"$R/logs/ngspice-make.log" 2>&1; make install >>"$R/logs/ngspice-make.log" 2>&1; cd "$R"
fi

[ -d src/Xyce ] || git clone --depth 1 --branch Release-7.10.0 https://github.com/Xyce/Xyce.git src/Xyce
[ -d src/Trilinos ] || { mkdir -p src/Trilinos; curl -fsSL https://github.com/trilinos/Trilinos/archive/refs/tags/trilinos-release-16-1-0.tar.gz | tar xz -C src/Trilinos --strip-components=1; }

build() { # $1=serial|mpi
  local kind=$1 preset=trilinos-base.cmake extra=()
  if [ "$kind" = mpi ]; then preset=trilinos-MPI-base.cmake; extra=(-D CMAKE_C_COMPILER=mpicc -D CMAKE_CXX_COMPILER=mpicxx -D CMAKE_Fortran_COMPILER=mpifort); fi
  if [ ! -f "opt/trilinos-$kind/lib/cmake/Trilinos/TrilinosConfig.cmake" ]; then
    mkdir -p "build/trilinos-$kind"; cd "build/trilinos-$kind"
    cmake -C "$R/src/Xyce/cmake/trilinos/$preset" "${extra[@]}" -D CMAKE_BUILD_TYPE=Release \
      -D CMAKE_INSTALL_PREFIX="$R/opt/trilinos-$kind" -D CMAKE_PREFIX_PATH="$CONDA_PREFIX" \
      -D AMD_INCLUDE_DIRS="$CONDA_PREFIX/include/suitesparse" -D AMD_LIBRARY_DIRS="$CONDA_PREFIX/lib" \
      "$R/src/Trilinos" >"$R/logs/trilinos-$kind-cmake.log" 2>&1
    cmake --build . -j "$J" -t install >"$R/logs/trilinos-$kind-build.log" 2>&1; cd "$R"
  fi
  if [ ! -x "opt/xyce-$kind/bin/Xyce" ]; then
    mkdir -p "build/xyce-$kind"; cd "build/xyce-$kind"
    cmake "${extra[@]}" -D CMAKE_BUILD_TYPE=Release -D CMAKE_INSTALL_PREFIX="$R/opt/xyce-$kind" \
      -D Trilinos_ROOT="$R/opt/trilinos-$kind" -D CMAKE_PREFIX_PATH="$CONDA_PREFIX" "$R/src/Xyce" >"$R/logs/xyce-$kind-cmake.log" 2>&1
    cmake --build . -j "$J" -t install >"$R/logs/xyce-$kind-build.log" 2>&1; cd "$R"
  fi
}
build serial
[ "${SKIP_MPI:-0}" = 1 ] || build mpi
"$R/opt/ngspice/bin/ngspice" -v | head -2
"$R/opt/xyce-serial/bin/Xyce" -v || true
[ -x "$R/opt/xyce-mpi/bin/Xyce" ] && "$R/opt/xyce-mpi/bin/Xyce" -v || true
