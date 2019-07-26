/*
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

const assert = require('assert');

const rebootDevice = async that => {
  const timestamp = new Date(
    await that.context.worker.executeCommandInHostOS(
      `date -d "$(</proc/uptime awk '{print $1}') seconds ago" --rfc-3339=seconds`,
      that.context.link,
    ),
  );
  await that.context.worker.executeCommandInHostOS(
    'shutdown -r now',
    that.context.link,
  );
  await that.context.utils.waitUntil(async () => {
    return (
      (await that.context.worker.executeCommandInHostOS(
        "timedatectl | grep synchronized | cut -d ':' -f 2",
        that.context.link,
      )) === 'yes'
    );
  });
  assert(
    new Date(
      await that.context.worker.executeCommandInHostOS(
        `date -d "$(</proc/uptime awk '{print $1}') seconds ago" --rfc-3339=seconds`,
        that.context.link,
      ),
    ) > timestamp,
    'Device should have rebooted',
  );
};

module.exports = {
  title: 'Config.json configuration tests',
  tests: [
    {
      title: 'hostname configuration test',
      run: async function(test) {
        const hostname = Math.random()
          .toString(36)
          .substring(2, 10);

        // Add hostname
        await this.context.worker.executeCommandInHostOS(
          `tmp=$(mktemp)&&cat /mnt/boot/config.json | jq '.hostname="${hostname}"' > $tmp&&mv "$tmp" /mnt/boot/config.json`,
          this.context.link,
        );

        // Start reboot check
        const boot0 = new Date(
          await this.context.worker.executeCommandInHostOS(
            `date -d "$(</proc/uptime awk '{print $1}') seconds ago" --rfc-3339=seconds`,
            this.context.link,
          ),
        );
        await this.context.worker.executeCommandInHostOS(
          'shutdown -r now',
          this.context.link,
        );
        await this.context.utils.waitUntil(async () => {
          return (
            (await this.context.worker.executeCommandInHostOS(
              "timedatectl | grep synchronized | cut -d ':' -f 2",
              `${hostname}.local`,
            )) === 'yes'
          );
        });
        assert(
          new Date(
            await this.context.worker.executeCommandInHostOS(
              `date -d "$(</proc/uptime awk '{print $1}') seconds ago" --rfc-3339=seconds`,
              `${hostname}.local`,
            ),
          ) > boot0,
          'Device should have rebooted',
        );
        test.equal(
          await this.context.worker.executeCommandInHostOS(
            'cat /etc/hostname',
            `${hostname}.local`,
          ),
          hostname,
          'Device should have new hostname',
        );

        // Remove hostname
        await this.context.worker.executeCommandInHostOS(
          'tmp=$(mktemp)&&cat /mnt/boot/config.json | jq "del(.hostname)" > $tmp&&mv "$tmp" /mnt/boot/config.json',
          `${hostname}.local`,
        );

        // Start reboot check
        const boot1 = new Date(
          await this.context.worker.executeCommandInHostOS(
            `date -d "$(</proc/uptime awk '{print $1}') seconds ago" --rfc-3339=seconds`,
            `${hostname}.local`,
          ),
        );
        await this.context.worker.executeCommandInHostOS(
          'shutdown -r now',
          `${hostname}.local`,
        );
        await this.context.utils.waitUntil(async () => {
          return (
            (await this.context.worker.executeCommandInHostOS(
              "timedatectl | grep synchronized | cut -d ':' -f 2",
              this.context.link,
            )) === 'yes'
          );
        });
        assert(
          new Date(
            await this.context.worker.executeCommandInHostOS(
              `date -d "$(</proc/uptime awk '{print $1}') seconds ago" --rfc-3339=seconds`,
              this.context.link,
            ),
          ) > boot1,
          'Device should have rebooted',
        );

        test.equal(
          await this.context.worker.executeCommandInHostOS(
            'cat /etc/hostname',
            this.context.link,
          ),
          this.context.link.split('.')[0],
          'Device should have old hostname',
        );
      },
    },
    {
      title: 'persistentLogging configuration test',
      run: async function(test) {
        const getBootCount = async () => {
          return parseInt(
            await this.context.worker.executeCommandInHostOS(
              'journalctl --list-boot | wc -l',
              this.context.link,
            ),
          );
        };

        await this.context.worker.executeCommandInHostOS(
          'tmp=$(mktemp)&&cat /mnt/boot/config.json | jq ".persistentLogging=true" > $tmp&&mv "$tmp" /mnt/boot/config.json',
          this.context.link,
        );

        await rebootDevice(this);

        const bootCount = await getBootCount();

        await rebootDevice(this);

        test.is(
          await getBootCount(),
          bootCount + 1,
          'Device should show previous boot records',
        );

        await this.context.worker.executeCommandInHostOS(
          'tmp=$(mktemp)&&cat /mnt/boot/config.json | jq "del(.persistentLogging)" > $tmp&&mv "$tmp" /mnt/boot/config.json',
          this.context.link,
        );

        await rebootDevice(this);

        test.is(
          await getBootCount(),
          1,
          'Device should only show current boot records',
        );
      },
    },
    {
      title: 'ntpServer test',
      run: async function(test) {
        const ntpServer = 'chronos.csr.net';

        await this.context.worker.executeCommandInHostOS(
          `tmp=$(mktemp)&&cat /mnt/boot/config.json | jq '.ntpServers="${ntpServer}"' > $tmp&&mv "$tmp" /mnt/boot/config.json`,
          this.context.link,
        );

        await rebootDevice(this);

        await test.resolves(
          this.context.worker.executeCommandInHostOS(
            `chronyc sources | grep ${ntpServer}`,
            this.context.link,
          ),
          'Device should show one record with our ntp server',
        );

        await this.context.worker.executeCommandInHostOS(
          'tmp=$(mktemp)&&cat /mnt/boot/config.json | jq "del(.ntpServer)" > $tmp&&mv "$tmp" /mnt/boot/config.json',
          this.context.link,
        );
      },
    },
    {
      title: 'dnsServer test',
      run: async function(test) {
        const dnsServer = '8.8.4.4';

        const serverFile = await this.context.worker.executeCommandInHostOS(
          "systemctl show dnsmasq  | grep ExecStart | sed -n 's/.*--servers-file=\\([^ ]*\\)\\s.*$/\\1/p'",
          this.context.link,
        );

        test.is(
          (await this.context.worker.executeCommandInHostOS(
            `cat ${serverFile}`,
            this.context.link,
          )).trim(),
          'server=8.8.8.8',
        );

        await this.context.worker.executeCommandInHostOS(
          `tmp=$(mktemp)&&cat /mnt/boot/config.json | jq '.dnsServers="${dnsServer}"' > $tmp&&mv "$tmp" /mnt/boot/config.json`,
          this.context.link,
        );
        await rebootDevice(this);

        test.is(
          (await this.context.worker.executeCommandInHostOS(
            `cat ${serverFile}`,
            this.context.link,
          )).trim(),
          `server=${dnsServer}`,
        );

        await this.context.worker.executeCommandInHostOS(
          'tmp=$(mktemp)&&cat /mnt/boot/config.json | jq "del(.dnsServer)" > $tmp&&mv "$tmp" /mnt/boot/config.json',
          this.context.link,
        );
      },
    },
    {
      title: 'os.network.connectivity test',
      os: {
        type: 'object',
        required: ['version'],
        properties: {
          version: {
            type: 'string',
            semver: {
              gt: '2.34.0',
            },
          },
        },
      },
      run: async function(test) {
        const connectivity = {
          uri: 'http://www.archlinux.org/check_network_status.txt',
        };

        await this.context.worker.executeCommandInHostOS(
          `tmp=$(mktemp)&&cat /mnt/boot/config.json | jq '.os.network.connectivity=${JSON.stringify(
            connectivity,
          )}' > $tmp&&mv "$tmp" /mnt/boot/config.json`,
          this.context.link,
        );

        await rebootDevice(this);

        const config = await this.context.worker.executeCommandInHostOS(
          'NetworkManager --print-config | awk "/\\[connectivity\\]/{flag=1;next}/\\[/{flag=0}flag"',
          this.context.link,
        );

        test.is(
          /uri=.*$/.exec(config),
          connectivity.uri,
          `NetworkManager should be configured with uri: ${connectivity.uri}`,
        );
        test.is(
          /interval=.*$/.exec(config),
          null,
          `NetworkManager should be configured with interval: ${
            connectivity.interval
          }`,
        );
        test.is(
          /response=.*$/.exec(config),
          null,
          `NetworkManager should be configured with the response: ${
            connectivity.response
          }`,
        );

        await this.context.worker.executeCommandInHostOS(
          'tmp=$(mktemp)&&cat /mnt/boot/config.json | jq "del(.os.network.connectivity)" > $tmp&&mv "$tmp" /mnt/boot/config.json',
          this.context.link,
        );
      },
    },
    {
      title: 'os.network.wifi.randomMacAddressScan test',
      run: async function(test) {
        await this.context.worker.executeCommandInHostOS(
          `tmp=$(mktemp)&&cat /mnt/boot/config.json | jq '.os.network.wifi.randomMacAddressScan=true' > $tmp&&mv "$tmp" /mnt/boot/config.json`,
          this.context.link,
        );

        await rebootDevice(this);

        const config = await this.context.worker.executeCommandInHostOS(
          'NetworkManager --print-config | awk "/\\[device\\]/{flag=1;next}/\\[/{flag=0}flag"',
          this.context.link,
        );

        test.match(
          config,
          /wifi.scan-rand-mac-address=yes/,
          'NetworkManager should be configured to randomize wifi MAC',
        );

        await this.context.worker.executeCommandInHostOS(
          `tmp=$(mktemp)&&cat /mnt/boot/config.json | jq 'del(.os.network.wifi)' > $tmp&&mv "$tmp" /mnt/boot/config.json`,
          this.context.link,
        );
      },
    },
    {
      title: 'udevRules test',
      run: async function(test) {
        const rule = {
          99: 'ENV{ID_FS_LABEL_ENC}=="resin-boot", SYMLINK+="disk/test"',
        };

        await this.context.worker.executeCommandInHostOS(
          `tmp=$(mktemp)&&cat /mnt/boot/config.json | jq '.os.udevRules=${JSON.stringify(
            rule,
          )}' > $tmp&&mv "$tmp" /mnt/boot/config.json`,
          this.context.link,
        );

        await rebootDevice(this);

        test.is(
          await this.context.worker.executeCommandInHostOS(
            'readlink -e /dev/disk/test',
            this.context.link,
          ),
          await this.context.worker.executeCommandInHostOS(
            'readlink -e /dev/disk/by-label/resin-boot',
            this.context.link,
          ),
          'Dev link should point to the correct device',
        );

        await this.context.worker.executeCommandInHostOS(
          `tmp=$(mktemp)&&cat /mnt/boot/config.json | jq 'del(.os.udevRules)' > $tmp&&mv "$tmp" /mnt/boot/config.json`,
          this.context.link,
        );
      },
    },
    {
      title: 'sshKeys test',
      run: async function(test) {
        await test.resolves(
          this.context.worker.executeCommandInHostOS(
            'echo true',
            this.context.link,
          ),
          'Should be able to establish ssh connection to the device',
        );
      },
    },
  ],
};