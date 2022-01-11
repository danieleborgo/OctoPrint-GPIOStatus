# coding=utf-8
"""
Copyright (C) 2022 Daniele Borgo
This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.
You should have received a copy of the GNU General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
"""

from __future__ import absolute_import
import octoprint.plugin
import subprocess
import gpiozero
from flask import jsonify
from shutil import which

__plugin_pythoncompat__ = ">=3,<4"  # only python 3


class GPIOStatusPlugin(
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.TemplatePlugin,
    octoprint.plugin.StartupPlugin,
    octoprint.plugin.ShutdownPlugin,
    octoprint.plugin.SimpleApiPlugin
):

    def __init__(self):
        super().__init__()

    def on_startup(self, host, port):
        self._logger.info("Plugin ready")

    def get_api_commands(self):
        return dict(
            gpio_status=[]
        )

    def on_api_command(self, command, data):
        self._logger.info("Refresh request received")
        if command == "gpio_status":
            return jsonify(GPIOStatusPlugin.__get_status())
        return None

    @staticmethod
    def __get_status():
        commands = {
            "raspi_config": which("raspi-config") is not None,
            "raspi_gpio": which("raspi-gpio") is not None
        }

        if not (commands["raspi_config"] and commands["raspi_gpio"]):
            return {
                "commands": commands
            }

        info = gpiozero.pi_info()
        status = GPIOStatusPlugin.__get_physical_pins(info)
        GPIOStatusPlugin.__inject_bcm_data_in_physicals(status["pins"])

        return {
            "commands": commands,
            "hardware": GPIOStatusPlugin.__get_hardware_data(info),
            "services": GPIOStatusPlugin.__get_services_status(),
            "status": status
        }

    @staticmethod
    def __get_hardware_data(info):
        return {
            "revision": info.revision,
            "model": info.model,
            "pcb_revision": info.pcb_revision,
            "released": info.released,
            "soc": info.soc,
            "manufacturer": info.manufacturer,
            "memory": info.memory,
            "storage": info.storage,
            "usb": info.usb,
            "usb3": info.usb3,
            "ethernet": info.ethernet,
            "eth_speed": info.eth_speed,
            "wifi": info.wifi,
            "bluetooth": info.bluetooth,
            "csi": info.csi,
            "dsi": info.dsi
        }

    @staticmethod
    def __get_services_status():
        return {
            "camera": GPIOStatusPlugin.__get_service_status("raspi-config nonint get_camera"),
            "ssh": GPIOStatusPlugin.__get_service_status("raspi-config nonint get_ssh"),
            "spi": GPIOStatusPlugin.__get_service_status("raspi-config nonint get_spi"),
            "i2c": GPIOStatusPlugin.__get_service_status("raspi-config nonint get_i2c"),
            "serial": GPIOStatusPlugin.__get_service_status("raspi-config nonint get_serial"),
            "serial_hw": GPIOStatusPlugin.__get_service_status("raspi-config nonint get_serial_hw"),
            "one_wire": GPIOStatusPlugin.__get_service_status("raspi-config nonint get_onewire"),
            "remote_gpio": GPIOStatusPlugin.__get_service_status("raspi-config nonint get_rgpio")
        }

    @staticmethod
    def __get_service_status(command):
        return GPIOStatusPlugin.__execute_command(command) == "0"

    @staticmethod
    def __execute_command(command):
        return subprocess.run(command.split(), capture_output=True).stdout.decode("utf-8").strip()

    @staticmethod
    def __get_physical_pins(info: gpiozero.PiBoardInfo):
        pinout = info.headers["J8" if "J8" in info.headers else "P1"]

        return {
            "rows": pinout.rows,
            "columns": pinout.columns,
            "pins": sorted([
                {
                    "physical_name": pinout.pins[key].number,
                    "name": pinout.pins[key].function
                }
                for key in pinout.pins
            ], key=lambda pin: pin["physical_name"])
        }

    @staticmethod
    def __inject_bcm_data_in_physicals(physical_pins):
        n_bcm_pins = GPIOStatusPlugin.__get_max_bcm_pin_int_value(physical_pins) + 1
        bcm_pins_status = GPIOStatusPlugin.__get_bcm_pins_status(n_bcm_pins)

        for pin in physical_pins:
            if pin["name"] in bcm_pins_status:
                pin["is_bcm"] = True
                pin.update(bcm_pins_status[pin["name"]])
            else:
                pin["is_bcm"] = False

    @staticmethod
    def __get_max_bcm_pin_int_value(pins):
        return max([int(pin["name"][4:]) for pin in pins if pin["name"].startswith("GPIO")])

    @staticmethod
    def __get_bcm_pins_status(n_bcm_pins):
        bcm_pins_status = GPIOStatusPlugin.__get_split_raw_bcm_pins_status(n_bcm_pins)
        bcm_pins_funcs = GPIOStatusPlugin.__get_split_raw_bcm_pins_funcs(n_bcm_pins)

        formatted = {}
        for i in range(len(bcm_pins_status)):
            status = bcm_pins_status[i]
            funcs = bcm_pins_funcs[i]

            formatted[f"GPIO{status[0]}"] = {
                "current_value": int(status[1]),  # level
                "pull": funcs[1],
                "current_func": status[2],  # alt or I/O
                "funcs": funcs[2:]
            }

        return formatted

    @staticmethod
    def __get_split_raw_bcm_pins_status(n_bcm_pins):
        return [
            [
                # GPIO pin number
                config[1].replace(":", ""),
                # pin level
                config[2][config[2].find("=") + 1:],
                # fsel not needed
                # pin function
                config[4][config[4].find("=") + 1:]
            ]
            for config in [
                config.split()
                for config in GPIOStatusPlugin.__execute_command(
                    f"raspi-gpio get {0}-{n_bcm_pins - 1}"
                ).split("\n")
            ]
        ]

    @staticmethod
    def __get_split_raw_bcm_pins_funcs(n_bcm_pins):
        return [
            config.split(", ")
            for config in GPIOStatusPlugin.__execute_command(
                f"raspi-gpio funcs {0}-{n_bcm_pins - 1}"
            ).split("\n")[1:]
        ]

    def get_settings_defaults(self):
        return dict(
            reload_on_check_change=False
        )

    def on_settings_save(self, data):
        octoprint.plugin.SettingsPlugin.on_settings_save(self, data)

    def get_template_configs(self):
        return [
            dict(type="tab", custom_bindings=True),
            dict(type="settings", custom_bindings=True)
        ]

    def get_assets(self):
        # Define your plugin's asset files to automatically include in the
        # core UI here.
        return {
            "js": ["js/gpiostatus.js"],
            "css": ["css/gpiostatus.css"]
            # "less": ["less/gpiostatus.less"]
        }

    def get_update_information(self):
        # Define the configuration for your plugin to use with the Software Update
        # Plugin here. See https://docs.octoprint.org/en/master/bundledplugins/softwareupdate.html
        # for details.
        return {
            "gpiostatus": {
                "displayName": "GPIOStatus Plugin",
                "displayVersion": self._plugin_version,

                # version check: github repository
                "type": "github_release",
                "user": "danieleborgo",
                "repo": "OctoPrint-GPIOStatus",
                "current": self._plugin_version,

                # update method: pip
                "pip": "https://github.com/danieleborgo/OctoPrint-GPIOStatus/archive/{target_version}.zip",
            }
        }


def __plugin_load__():
    global __plugin_implementation__
    __plugin_implementation__ = GPIOStatusPlugin()

    global __plugin_hooks__
    __plugin_hooks__ = {
        "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information
    }
