/*
 * Copyright (C) 2022 Daniele Borgo
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

$(function () {
    function GPIOStatusViewModel(parameters) {
        let self = this;

        // assign the injected parameters, e.g.:
        // self.loginStateViewModel = parameters[0];
        self.settingsViewModel = parameters[0]; // For future

        self.updated_hour = ko.observable("-");
        self.set_hour = function () {
            let date = new Date($.now());
            self.updated_hour(date.toLocaleDateString() + " " + date.toLocaleTimeString());
        }

        self.compact_view = ko.observable(true);
        self.checkUpdated = function () {
            self.refresh();
            return true;
        }

        self.refresh = function () {
            self.set_text_all_output("Updating...");

            $.ajax({
                url: API_BASEURL + "plugin/gpiostatus",
                type: "POST",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: JSON.stringify({
                    command: "gpio_status"
                })
            }).done(function (data) {
                console.log("GPIO status data arrived");

                if (data.commands.raspi_config && data.commands.raspi_gpio) {
                    self.parse_gpio_status_and_funcs(data.status);
                    self.parse_services(data.services);
                    self.parse_hardware(data.hardware);
                }
                else
                    self.set_commands_unavailable(data.commands);
            }).fail(function () {
                console.log("Error");
                self.set_text_all_output("Failed to retrieve");
            }).always(function () {
                self.set_hour();
            });
        }

        self.gpio_table = ko.observable();
        self.funcs_table = ko.observable();
        self.parse_gpio_status_and_funcs = function (gpio_status) {
            let rows = gpio_status.rows;
            let columns = gpio_status.columns;
            let pins = gpio_status.pins;
            let compact_view = self.compact_view();

            if (columns !== 2 || rows % 2 === 1)
                throw "This is not possible: col=" + columns + " row=" + rows;

            self.prepare_header(compact_view);

            let raw_gpio_table = [];
            let raw_func_table = [];
            pins.forEach(function (pin) {
                raw_gpio_table.push(self.prepare_row(pin));

                if (pin.is_bcm)
                    raw_func_table.push(Array(pin.name).concat(self.format_alts(pin.funcs)))
            })
            raw_func_table.sort(function (pin1, pin2) {
                return parseInt(pin1[0].substr(4)) < parseInt(pin2[0].substr(4)) ? -1 : 1;
            })

            if (compact_view) {
                let reformatted_table = [];
                for (let i = 0; i < raw_gpio_table.length; i += 2)
                    reformatted_table.push(raw_gpio_table[i].reverse().concat(raw_gpio_table[i + 1]));
                raw_gpio_table = reformatted_table;
            }

            self.gpio_table(self.put_in_html_table(raw_gpio_table))
            self.funcs_table(self.put_in_html_table(raw_func_table));
        }

        self.wrap_span = function (value, css_classes = "") {
            return "<span class='" + css_classes + "'>" + value + "</span>";
        }

        self.wrap_array_td = function (array) {
            return self.wrap_array_with_tag(array, "td")
        }

        self.wrap_array_tr = function (array) {
            return self.wrap_array_with_tag(array, "tr")
        }

        self.wrap_array_with_tag = function (array, tag) {
            return "<" + tag + ">" + array.join("</" + tag + "><" + tag + ">") + "</" + tag + ">";
        }

        self.gpio_table_header = ko.observable();
        self.gpio_table_headers_list = ["Physical", "Name", "Function", "Pull", "Voltage"];
        self.gpio_table_headers_list_html =
            "<tr>" +
            self.wrap_array_td(["Image"].concat(self.gpio_table_headers_list)) +
            "</tr>";
        self.gpio_table_headers_list_comp_html =
            "<tr>" +
            self.wrap_array_td(self.gpio_table_headers_list.slice(1).reverse()) +
            "<td colspan='4'>" + self.gpio_table_headers_list[0] + "</td>" +
            self.wrap_array_td(self.gpio_table_headers_list.slice(1)) +
            "</tr>";
        self.prepare_header = function (compact_view) {
            self.gpio_table_header(
                compact_view ?
                    self.gpio_table_headers_list_comp_html :
                    self.gpio_table_headers_list_html
            );
        }

        self.prepare_row = function (pin_status) {
            if (pin_status.is_bcm)
                return [
                    self.get_image(pin_status.name, true),
                    self.format_physical(pin_status.physical_name),
                    pin_status.name,
                    self.format_func(pin_status),
                    self.format_pull(pin_status.pull),
                    self.format_value(pin_status.current_value)
                ];
            return [
                self.get_image(pin_status.name, false),
                self.format_physical(pin_status.physical_name),
                self.format_special_pin_name(pin_status.name),
                "", "", ""
            ];
        }

        self.img_folder = "/plugin/gpiostatus/static/img/";
        self.raspberry_image = ko.observable(self.img_folder + "Raspberry.jpg");
        self.create_img = function (name) {
            return "<img src='" + self.img_folder + name + ".png' class='td_img' alt='-'>";
        }

        self.img5v = self.create_img("5V");
        self.img3v3 = self.create_img("3V3");
        self.imgGND = self.create_img("GND");
        self.imgGPIO = self.create_img("GPIO");
        self.imgGPIO_no = self.create_img("GPIO_NO");
        self.get_image = function (name, is_bcm) {
            if (is_bcm) {
                if (parseInt(name.substr(4)) > 1)
                    return self.imgGPIO;
                return self.imgGPIO_no;
            }
            if (name === "GND")
                return self.imgGND;
            if (name === "5V")
                return self.img5v;
            return self.img3v3;
        }

        self.format_physical = function (value) {
            return self.wrap_span(value, "td_phyisical");
        }

        self.format_special_pin_name = function (pin_name) {
            if (pin_name === "GND")
                return self.wrap_span(pin_name, "td_gnd");
            if (pin_name === "5V")
                return self.wrap_span(pin_name, "td_5v");
            if (pin_name === "3V3")
                return self.wrap_span(pin_name, "td_3v3");
            return pin_name
        }

        self.format_pull = function (pull) {
            if (pull === "UP")
                return self.wrap_span(pull, "td_pull_up");
            return self.wrap_span(pull, "td_pull_down");
        }

        self.level_high_html = self.wrap_span("HIGH", "td_high");
        self.level_low_html = self.wrap_span("LOW", "td_low");
        self.format_value = function (value) {
            return value === 1 ? self.level_high_html : self.level_low_html;
        }

        self.table_input_html = self.wrap_span("IN", "td_in");
        self.table_output_html = self.wrap_span("OUT", "td_out");
        self.format_func = function (pin_status) {
            if (pin_status.current_func === "OUTPUT")
                return self.table_output_html;
            if (pin_status.current_func === "INPUT")
                return self.table_input_html;
            return pin_status.funcs[pin_status.current_func];
        }

        self.format_alts = function (alts){
            let formatted = []

            alts.forEach(function (alt){
                if(alt.startsWith("SPI")) {
                    formatted.push(self.wrap_span(alt, 'td_spi'));
                    return;
                }
                if(alt.startsWith("SDA1") || alt.startsWith("SCL1")){
                    formatted.push(self.wrap_span(alt, 'td_i2c'));
                    return;
                }
                formatted.push(alt);
            });

            return formatted;
        }

        self.put_in_html_table = function (array) {
            let wrapped = [];
            array.forEach(function (row) {
                wrapped.push(self.wrap_array_td(row))
            })
            return self.wrap_array_tr(wrapped);
        }

        self.camera_status = ko.observable();
        self.ssh_status = ko.observable();
        self.spi_status = ko.observable();
        self.i2c_status = ko.observable();
        self.serial_status = ko.observable();
        self.serial_hw_status = ko.observable();
        self.one_wire_status = ko.observable();
        self.rgpio_status = ko.observable();
        self.parse_services = function (services_status) {
            self.camera_status(self.service_status_to_str(services_status.camera));
            self.ssh_status(self.service_status_to_str(services_status.ssh));
            self.spi_status(self.service_status_to_str(services_status.spi));
            self.i2c_status(self.service_status_to_str(services_status.i2c));
            self.serial_status(self.service_status_to_str(services_status.serial));
            self.serial_hw_status(self.service_status_to_str(services_status.serial_hw));
            self.one_wire_status(self.service_status_to_str(services_status.one_wire));
            self.rgpio_status(self.service_status_to_str(services_status.remote_gpio));
        }

        self.service_status_to_str = function (status) {
            return status ? "enabled" : "disabled";
        }

        self.model_value = ko.observable();
        self.revision_value = ko.observable();
        self.pcb_revision_value = ko.observable();
        self.released_value = ko.observable();
        self.manufacturer_value = ko.observable();
        self.soc_value = ko.observable();
        self.storage_value = ko.observable();
        self.usb_value = ko.observable();
        self.usb3_value = ko.observable();
        self.memory_value = ko.observable();
        self.eth_speed_value = ko.observable();
        self.ethernet_value = ko.observable();
        self.wifi_value = ko.observable();
        self.bluetooth_value = ko.observable();
        self.csi_value = ko.observable();
        self.dsi_value = ko.observable();
        self.parse_hardware = function (hardware) {
            self.model_value(hardware.model);
            self.revision_value(hardware.revision);
            self.pcb_revision_value(hardware.pcb_revision);
            self.released_value(hardware.released);
            self.manufacturer_value(hardware.manufacturer);
            self.soc_value(hardware.soc);
            self.storage_value(hardware.storage);
            self.usb_value(self.add_port_or_ports(hardware.usb));
            self.usb3_value(self.add_port_or_ports(hardware.usb3));
            self.memory_value(hardware.memory + "MB");
            self.eth_speed_value(hardware.eth_speed + "Mbps");
            self.ethernet_value(self.add_port_or_ports(hardware.ethernet));
            self.wifi_value(hardware.wifi ? "Available" : "Unavailable");
            self.bluetooth_value(hardware.bluetooth ? "Available" : "Unavailable");
            self.csi_value(hardware.csi ? "Available" : "Unavailable");
            self.dsi_value(hardware.dsi ? "Available" : "Unavailable");
        }

        self.add_port_or_ports = function (n) {
            return n + " port" + (n === 1 ? "" : "s");
        }

        self.set_text_all_output = function (text) {
            self.updated_hour(text)
            self.gpio_table_header("<tr><td>" + text + "</td></tr>")
            self.gpio_table("<tr><td>" + text + "</td></tr>")
            self.funcs_table("<tr><td colspan='7'>" + text + "</td></tr>")
            self.camera_status(text);
            self.ssh_status(text);
            self.spi_status(text);
            self.i2c_status(text);
            self.serial_status(text);
            self.serial_hw_status(text);
            self.one_wire_status(text);
            self.camera_status(text);
            self.rgpio_status(text);
            self.model_value(text);
            self.revision_value(text);
            self.pcb_revision_value(text);
            self.released_value(text);
            self.manufacturer_value(text);
            self.soc_value(text);
            self.storage_value(text);
            self.usb_value(text);
            self.usb3_value(text);
            self.memory_value(text);
            self.eth_speed_value(text);
            self.ethernet_value(text);
            self.wifi_value(text);
            self.bluetooth_value(text);
            self.csi_value(text);
            self.dsi_value(text);
        }

        self.notification = ko.observable();
        self.set_commands_unavailable = function (commands) {
            let config = !commands.raspi_config;
            let gpio = !config.raspi_gpio;

            if (config && gpio)
                self.notification(
                    "<h4>Commands <i>raspi-config</i> and <i>raspi-gpio</i> not found. " +
                    "Please install these two to the Raspberry</h4>"
                )
            else
                self.notification(
                    "<h4>Command <i>raspi-" + (config ? "config" : "gpio") + "</i> not found. " +
                    "Please install this on to Raspberry</h4>"
                )
            self.set_text_all_output("Failed to retrieve")
        }

        self.onStartupComplete = function () {
            self.refresh()
        }
    }

    /* view model class, parameters for constructor, container to bind to
     * Please see http://docs.octoprint.org/en/master/plugins/viewmodels.html#registering-custom-viewmodels for more details
     * and a full list of the available options.
     */
    OCTOPRINT_VIEWMODELS.push({
        construct: GPIOStatusViewModel,
        // ViewModels your plugin depends on, e.g. loginStateViewModel, settingsViewModel, ...
        dependencies: ["settingsViewModel"],
        // Elements to bind to, e.g. #settings_plugin_gpiostatus, #tab_plugin_gpiostatus, ...
        elements: ["#settings_plugin_gpiostatus"]
    });
});
