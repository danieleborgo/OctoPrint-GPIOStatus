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

import subprocess
from copy import deepcopy
from shutil import which

import gpiozero
import octoprint.plugin
from flask import jsonify

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
        self.__hardware_data = None
        self.__physical_pins = None
        self.__max_bcm_pin = None
        self.__raw_funcs = None

    def on_startup(self, host, port):
        info = gpiozero.pi_info()
        self.__compute_hardware_data(info)
        self.__prepare_physical_pins(info)
        self.__max_bcm_pin = GPIOStatusPlugin.__get_max_bcm_pin_val(self.__physical_pins["pins"])

        self._logger.info("Plugin ready")

    def get_api_commands(self):
        return dict(
            gpio_status=[]
        )

    def on_api_command(self, command, data):
        if command == "gpio_status":
            self._logger.info("Refresh request received")
            return jsonify(self.__get_status(
                hw_required=("hw" not in data) or data["hw"],
                funcs_required=("funcs" not in data) or data["funcs"]
            ))

        return None

    def __get_status(self, hw_required=True, funcs_required=True):
        commands = {
            "raspi_config": which("raspi-config") is not None,
            "raspi_gpio": which("raspi-gpio") is not None
        }

        if not (commands["raspi_config"] and commands["raspi_gpio"]):
            return {
                "commands": commands
            }

        self.__prepare_raw_funcs_if_necessary()
        status = self.__get_physical_pins_copied()
        self.__inject_bcm_data(status["pins"], funcs_required)

        formatted_status = {
            "commands": commands,
            "services": GPIOStatusPlugin.__get_services_status(),
            "status": status
        }

        if hw_required:
            formatted_status["hardware"] = self.__hardware_data

        return formatted_status

    def __compute_hardware_data(self, info):
        # This data cannot change during execution
        self.__hardware_data = {
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

    def __prepare_physical_pins(self, info: gpiozero.PiBoardInfo):
        pinout = info.headers["J8" if "J8" in info.headers else "P1"]

        self.__physical_pins = {
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

    def __get_physical_pins_copied(self):
        return deepcopy(self.__physical_pins)

    def __inject_bcm_data(self, physical_pins, funcs_required=True):
        bcm_pins_status = self.__get_bcm_pins_status(funcs_required)

        for pin in physical_pins:
            if pin["name"] in bcm_pins_status:
                pin["is_bcm"] = True
                pin.update(bcm_pins_status[pin["name"]])
            else:
                pin["is_bcm"] = False

    @staticmethod
    def __get_max_bcm_pin_val(pins):
        return max([int(pin["name"][4:]) for pin in pins if pin["name"].startswith("GPIO")])

    def __get_bcm_pins_status(self, funcs_required=True):
        bcm_pins_status = self.__get_raw_status()

        formatted = {}
        for i in range(len(bcm_pins_status)):
            status = bcm_pins_status[i]
            funcs = self.__raw_funcs[i]
            index = f"GPIO{status[0]}"

            formatted[index] = {
                "current_value": int(status[1]),  # level
                "pull": funcs[1],
                "current_func": status[2]  # alt or I/O
            }

            if funcs_required:
                formatted[index]["funcs"] = funcs[2:]

        return formatted

    def __get_raw_status(self):
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
                    f"raspi-gpio get {0}-{self.__max_bcm_pin}"
                ).split("\n")
            ]
        ]

    def __prepare_raw_funcs_if_necessary(self):
        if self.__raw_funcs is None:
            self.__raw_funcs = [
                config.split(", ")
                for config in GPIOStatusPlugin.__execute_command(
                    f"raspi-gpio funcs {0}-{self.__max_bcm_pin}"
                ).split("\n")[1:]
            ]

    def get_settings_defaults(self):
        return dict(
            reload_on_check_change=False,
            load_on_startup=True,
            compact_view=True,
            hide_special_pins=False,
            order_by_name=False,
            hide_physical=False,
            show_notes=False,
            hide_images=False,
            pins_notes_json="{}"
        )

    def on_settings_save(self, data):
        if self.__is_data_correct(data):
            octoprint.plugin.SettingsPlugin.on_settings_save(self, data)
            return

        # This happens in case of a JS bug
        self._logger.info("Saving rejected: constraint not followed")

    def __is_data_correct(self, data):
        return not (self.__pick_newest("compact_view", data) and
                    (
                            self.__pick_newest("hide_special_pins", data) or
                            self.__pick_newest("order_by_name", data) or
                            self.__pick_newest("show_notes", data)
                    ))

    def __pick_newest(self, name, data):
        return data[name] if name in data else self._settings.get_boolean([name])

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
                "displayName": "GPIO Status Plugin",
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
