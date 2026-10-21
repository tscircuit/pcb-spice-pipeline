# Board pinmux integration requirements

USB1_OCn uses U1.V17 (GPMC_A11), mux mode 7, GPIO1_27 input on the 3.3 V VDDSHV3 bank. Its existing 10 kΩ pull-up and TPS2052B active-low fault output are retained. Software must monitor GPIO1_27; the previous GPIO1_20 mapping is superseded.

RGB serial data uses U1.B17 (SPI0_D0), mux mode 0, on VDDSHV6. Configure SPI0 with `ti,pindir-d0-out-d1-in` so D0 is its output; D1/B16 is unused. The Linux McSPI binding explicitly supports this direction swap. No external SPI clock, chip-select, or receive data is connected to the LEDs. This documents hardware integration requirements; a complete bootable board device tree and LED driver are not supplied or validated here.

Sources: TI AM3352 SPRS717L Tables 4-2 and 4-53; https://github.com/torvalds/linux/blob/master/Documentation/devicetree/bindings/spi/omap-spi.yaml
